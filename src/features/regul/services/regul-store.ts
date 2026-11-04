import { requireAccess, requireAdmin } from "@/features/access/services/access-rules";
import type { AuthUser } from "@/features/access/types";
import { logAction } from "@/features/journal/services/journal-service";
import { REGUL_PROD, REGUL_SUCCURSALES, type BaseRow, type Fait, type RegulIndex, type RegulSaved, type RegulSin, type Saisie, type TcdMonth } from "@/features/regul/services/regul-engine";
import { db } from "@/lib/db";
import { fail, ok, type ActionResult } from "@/types";
import { todayIso } from "@/utils/dates";

/* Stockage de la régularisation CAAT dans la table « Setting » (clé → JSON) : index, base de production par succursale,
   base sinistres, montants saisis et résultats enregistrés. */

const KEY_INDEX = "regul:index";
const KEY_SIN = "regul:sinistres";
const keyBase = (succ: string): string => `regul:base:${succ}`;
const KEY_SAISIE = "regul:saisie:";
const KEY_RES = "regul:res:";

const EMPTY_INDEX: RegulIndex = { prod: [...REGUL_PROD], faits: {}, baseMois: {}, tcd: {}, agences: {}, lignes: {}, maj: "", source: "" };

async function read<T>(key: string): Promise<T | null> {
  const row = await db.setting.findUnique({ where: { key } });
  return row ? (row.value as T) : null;
}

async function write(key: string, value: unknown): Promise<void> {
  const json = JSON.parse(JSON.stringify(value)) as never;
  await db.setting.upsert({ where: { key }, create: { key, value: json }, update: { value: json } });
}

/** Contenu de l'écran : index, base sinistres (sans les clés), saisies et résultats enregistrés. */
export interface RegulOverview {
  index: RegulIndex | null;
  sin: { jusqua: string; maj: string; dossiers: number; cles: number } | null;
  saved: Record<string, RegulSaved>;
}

/** Index de la base, résumé de la base sinistres et résultats enregistrés. */
export async function regulOverview(actor: AuthUser): Promise<ActionResult<RegulOverview>> {
  const guard = requireAccess(actor, "FCLI");
  if (!guard.success) return guard;
  try {
    const [index, sin, resRows] = await Promise.all([read<RegulIndex>(KEY_INDEX), read<RegulSin>(KEY_SIN), db.setting.findMany({ where: { key: { startsWith: KEY_RES } } })]);
    const saved: Record<string, RegulSaved> = {};
    for (const row of resRows) saved[row.key.slice(KEY_RES.length)] = row.value as unknown as RegulSaved;
    return ok({ index, sin: sin ? { jusqua: sin.jusqua, maj: sin.maj, dossiers: sin.dossiers, cles: sin.keys.length } : null, saved });
  } catch (error) {
    console.error("[regul] aperçu :", error);
    return fail("La base de régularisation n'a pas pu être lue.", "DATABASE");
  }
}

/** Données nécessaires au calcul d'une succursale : production, clés sinistres et montants saisis. */
export interface RegulWorkData {
  base: BaseRow[];
  sinKeys: string[] | null;
  saisies: Record<string, Saisie>;
}

/** Production en base d'une succursale, base sinistres et montants saisis. */
export async function regulWorkData(actor: AuthUser, succ: string): Promise<ActionResult<RegulWorkData>> {
  const guard = requireAccess(actor, "FCLI");
  if (!guard.success) return guard;
  if (!(REGUL_SUCCURSALES as readonly string[]).includes(succ)) return fail("Succursale inconnue.", "VALIDATION");
  try {
    const [base, sin, rows] = await Promise.all([read<BaseRow[]>(keyBase(succ)), read<RegulSin>(KEY_SIN), db.setting.findMany({ where: { key: { startsWith: `${KEY_SAISIE}${succ.replace(/ /g, "_")}-` } } })]);
    const saisies: Record<string, Saisie> = {};
    for (const row of rows) saisies[row.key.slice(KEY_SAISIE.length)] = row.value as unknown as Saisie;
    return ok({ base: base ?? [], sinKeys: sin ? sin.keys : null, saisies });
  } catch (error) {
    console.error("[regul] données :", error);
    return fail("Les données de la succursale n'ont pas pu être lues.", "DATABASE");
  }
}

/** Enregistre un montant saisi à la main (total ou avance d'un mois). */
export async function saveSaisie(actor: AuthUser, key: string, succ: string, field: "total" | "avance", value: number): Promise<ActionResult<true>> {
  const guard = requireAccess(actor, "FCLI", "EDIT");
  if (!guard.success) return guard;
  try {
    const old = (await read<Saisie>(`${KEY_SAISIE}${key}`)) ?? { succ };
    await write(`${KEY_SAISIE}${key}`, { ...old, succ, [field]: value });
    await logAction(actor, "Régul CAAT : montant saisi", `${key} ${field} = ${value}`);
    return ok(true);
  } catch (error) {
    console.error("[regul] saisie :", error);
    return fail("Le montant n'a pas pu être enregistré.", "DATABASE");
  }
}

/** Enregistre les résultats d'une régularisation dans le suivi. */
export async function saveResults(actor: AuthUser, results: Array<RegulSaved & { key: string }>, resume: string): Promise<ActionResult<true>> {
  const guard = requireAccess(actor, "FCLI", "EDIT");
  if (!guard.success) return guard;
  try {
    for (const { key, ...rest } of results) await write(`${KEY_RES}${key}`, { ...rest, maj: todayIso() });
    await logAction(actor, "Régul CAAT : résultat enregistré", resume);
    return ok(true);
  } catch (error) {
    console.error("[regul] résultats :", error);
    return fail("Le résultat n'a pas pu être enregistré.", "DATABASE");
  }
}

/** Remplace la production d'une succursale (administrateur). */
export async function saveBase(actor: AuthUser, succ: string, rows: BaseRow[]): Promise<ActionResult<true>> {
  const guard = requireAdmin(actor);
  if (!guard.success) return guard;
  if (!(REGUL_SUCCURSALES as readonly string[]).includes(succ)) return fail("Succursale inconnue.", "VALIDATION");
  try {
    await write(keyBase(succ), rows);
    return ok(true);
  } catch (error) {
    console.error("[regul] base :", error);
    return fail("La production n'a pas pu être enregistrée.", "DATABASE");
  }
}

/** Données du consolidé à fusionner dans l'index. */
export interface IndexMerge {
  lignes: Record<string, number>;
  tcd: Record<string, Record<string, TcdMonth>>;
  hist: Record<string, Record<string, Fait>>;
  baseMois: Record<string, Record<string, number>>;
  agences: Record<string, string>;
  source: string;
  total: number;
}

/** Fusionne le TCD, l'historique et les totaux mensuels du consolidé dans l'index (administrateur). */
export async function saveIndex(actor: AuthUser, merge: IndexMerge): Promise<ActionResult<true>> {
  const guard = requireAdmin(actor);
  if (!guard.success) return guard;
  try {
    const old = (await read<RegulIndex>(KEY_INDEX)) ?? EMPTY_INDEX;
    const faits = JSON.parse(JSON.stringify(old.faits)) as RegulIndex["faits"];
    for (const [s, months] of Object.entries(merge.hist)) for (const [k, v] of Object.entries(months)) (faits[s] ??= {})[k] = { ...(faits[s]?.[k] ?? {}), ...v };
    const tcd = { ...old.tcd };
    for (const [s, months] of Object.entries(merge.tcd)) tcd[s] = { ...(tcd[s] ?? {}), ...months };
    const next: RegulIndex = {
      prod: [...REGUL_PROD],
      faits,
      baseMois: { ...old.baseMois, ...merge.baseMois },
      tcd,
      agences: { ...old.agences, ...merge.agences },
      lignes: { ...old.lignes, ...merge.lignes },
      maj: todayIso(),
      source: `${merge.source} (onglets TCD et EXTRACTION CAAT VALID 25-26, 2026)`,
    };
    await write(KEY_INDEX, next);
    await logAction(actor, "Régul CAAT : base production mise à jour", `${merge.total} lignes (${merge.source})`, true);
    return ok(true);
  } catch (error) {
    console.error("[regul] index :", error);
    return fail("L'index de la base n'a pas pu être enregistré.", "DATABASE");
  }
}

/** Remplace la base sinistres : seules les clés « police | immatriculation » sont conservées (administrateur). */
export async function saveSinistres(actor: AuthUser, input: { keys: string[]; jusqua: string; dossiers: number }): Promise<ActionResult<true>> {
  const guard = requireAdmin(actor);
  if (!guard.success) return guard;
  try {
    await write(KEY_SIN, { keys: input.keys, jusqua: input.jusqua, dossiers: input.dossiers, maj: todayIso() });
    await logAction(actor, "Régul CAAT : base sinistres mise à jour", `${input.dossiers} dossiers`, true);
    return ok(true);
  } catch (error) {
    console.error("[regul] sinistres :", error);
    return fail("La base sinistres n'a pas pu être enregistrée.", "DATABASE");
  }
}
