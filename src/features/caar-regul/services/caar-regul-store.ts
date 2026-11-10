import { requireAccess, requireAdmin } from "@/features/access/services/access-rules";
import type { AuthUser } from "@/features/access/types";
import { CAAR_SUCCURSALES, ymKey, type CaarBaseRow, type CaarFacture, type CaarMoisBase, type CaarRegulIndex, type CaarRegulSaved, type CaarRegulSin, type CaarSaisie } from "@/features/caar-regul/services/caar-regul-engine";
import { logAction } from "@/features/journal/services/journal-service";
import { db } from "@/lib/db";
import { fail, ok, type ActionResult } from "@/types";
import { todayIso } from "@/utils/dates";

/* Stockage de la régularisation CAAR dans la table « Setting » (clé → JSON), comme la régularisation CAAT :
   index (formules, totaux mensuels, factures d'avance), production par succursale et par mois, base activité, avances saisies, résultats. */

const KEY_INDEX = "caarregul:index";
const KEY_SIN = "caarregul:sinistres";
const keyBase = (succ: string, ym: number): string => `caarregul:base:${succ}:${ymKey(ym)}`;
const KEY_SAISIE = "caarregul:saisie:";
const KEY_RES = "caarregul:res:";

const isSucc = (s: string): boolean => (CAAR_SUCCURSALES as readonly string[]).includes(s);

async function read<T>(key: string): Promise<T | null> {
  const row = await db.setting.findUnique({ where: { key } });
  return row ? (row.value as T) : null;
}

async function write(key: string, value: unknown): Promise<void> {
  const json = JSON.parse(JSON.stringify(value)) as never;
  await db.setting.upsert({ where: { key }, create: { key, value: json }, update: { value: json } });
}

/** Contenu de l'écran : index, résumé de la base activité et résultats enregistrés. */
export interface CaarRegulOverview {
  index: CaarRegulIndex | null;
  sin: { jusqua: string; maj: string; dossiers: number; cles: number } | null;
  saved: Record<string, CaarRegulSaved>;
}

/** Index de la base, résumé de la base activité et résultats enregistrés. */
export async function caarRegulOverview(actor: AuthUser): Promise<ActionResult<CaarRegulOverview>> {
  const guard = requireAccess(actor, "FCLI");
  if (!guard.success) return guard;
  try {
    const [index, sin, resRows] = await Promise.all([read<CaarRegulIndex>(KEY_INDEX), read<CaarRegulSin>(KEY_SIN), db.setting.findMany({ where: { key: { startsWith: KEY_RES } } })]);
    const saved: Record<string, CaarRegulSaved> = {};
    for (const row of resRows) saved[row.key.slice(KEY_RES.length)] = row.value as unknown as CaarRegulSaved;
    return ok({ index, sin: sin ? { jusqua: sin.jusqua, maj: sin.maj, dossiers: sin.dossiers, cles: sin.keys.length } : null, saved });
  } catch (error) {
    console.error("[caar-regul] aperçu :", error);
    return fail("La base de régularisation CAAR n'a pas pu être lue.", "DATABASE");
  }
}

/** Données nécessaires au calcul : production des mois demandés, clés de la base activité et avances saisies. */
export interface CaarRegulWorkData {
  base: CaarBaseRow[];
  sinKeys: string[] | null;
  saisies: Record<string, CaarSaisie>;
}

/** Production en base d'une succursale pour les mois demandés, base activité et avances saisies. */
export async function caarRegulWorkData(actor: AuthUser, succ: string, months: readonly number[]): Promise<ActionResult<CaarRegulWorkData>> {
  const guard = requireAccess(actor, "FCLI");
  if (!guard.success) return guard;
  if (!isSucc(succ)) return fail("Succursale inconnue.", "VALIDATION");
  try {
    const [parts, sin, rows] = await Promise.all([
      Promise.all(months.map((m) => read<CaarBaseRow[]>(keyBase(succ, m)))),
      read<CaarRegulSin>(KEY_SIN),
      db.setting.findMany({ where: { key: { startsWith: `${KEY_SAISIE}${succ}-` } } }),
    ]);
    const saisies: Record<string, CaarSaisie> = {};
    for (const row of rows) saisies[row.key.slice(KEY_SAISIE.length)] = row.value as unknown as CaarSaisie;
    return ok({ base: parts.flatMap((p) => p ?? []), sinKeys: sin ? sin.keys : null, saisies });
  } catch (error) {
    console.error("[caar-regul] données :", error);
    return fail("Les données de la succursale n'ont pas pu être lues.", "DATABASE");
  }
}

/** Enregistre l'avance HT d'un mois saisie à la main (virement confirmé par la banque). */
export async function saveCaarAvance(actor: AuthUser, key: string, succ: string, avance: number): Promise<ActionResult<true>> {
  const guard = requireAccess(actor, "FCLI", "EDIT");
  if (!guard.success) return guard;
  try {
    await write(`${KEY_SAISIE}${key}`, { succ, avance });
    await logAction(actor, "Régul CAAR : avance saisie", `${key} avance = ${avance}`);
    return ok(true);
  } catch (error) {
    console.error("[caar-regul] saisie :", error);
    return fail("Le montant n'a pas pu être enregistré.", "DATABASE");
  }
}

/** Enregistre les résultats d'une régularisation dans le suivi. */
export async function saveCaarResults(actor: AuthUser, results: Array<CaarRegulSaved & { key: string }>, resume: string): Promise<ActionResult<true>> {
  const guard = requireAccess(actor, "FCLI", "EDIT");
  if (!guard.success) return guard;
  try {
    for (const { key, ...rest } of results) await write(`${KEY_RES}${key}`, { ...rest, maj: todayIso() });
    await logAction(actor, "Régul CAAR : résultat enregistré", resume);
    return ok(true);
  } catch (error) {
    console.error("[caar-regul] résultats :", error);
    return fail("Le résultat n'a pas pu être enregistré.", "DATABASE");
  }
}

/** Remplace la production d'une succursale pour un mois (administrateur). */
export async function saveCaarBase(actor: AuthUser, succ: string, ym: number, rows: CaarBaseRow[]): Promise<ActionResult<true>> {
  const guard = requireAdmin(actor);
  if (!guard.success) return guard;
  if (!isSucc(succ)) return fail("Succursale inconnue.", "VALIDATION");
  try {
    await write(keyBase(succ, ym), rows);
    return ok(true);
  } catch (error) {
    console.error("[caar-regul] base :", error);
    return fail("La production n'a pas pu être enregistrée.", "DATABASE");
  }
}

/** Contenu de l'index envoyé après lecture du consolidé. */
export interface CaarIndexInput {
  forms: string[];
  mois: Record<string, Record<string, CaarMoisBase>>;
  factures: Record<string, Record<string, CaarFacture>>;
  lignes: Record<string, number>;
  source: string;
  total: number;
}

/** Remplace l'index (formules, totaux mensuels, factures d'avance) après le dépôt du consolidé (administrateur). */
export async function saveCaarIndex(actor: AuthUser, input: CaarIndexInput): Promise<ActionResult<true>> {
  const guard = requireAdmin(actor);
  if (!guard.success) return guard;
  try {
    const next: CaarRegulIndex = { forms: input.forms, mois: input.mois, factures: input.factures, lignes: input.lignes, maj: todayIso(), source: `${input.source} (onglets CONSOLIDE et RECAP FACTURES)` };
    await write(KEY_INDEX, next);
    await logAction(actor, "Régul CAAR : consolidé ALLO & CAAR mis à jour", `${input.total} lignes (${input.source})`, true);
    return ok(true);
  } catch (error) {
    console.error("[caar-regul] index :", error);
    return fail("L'index de la base n'a pas pu être enregistré.", "DATABASE");
  }
}

/** Remplace la base activité : seules les clés « police | immatriculation » des dossiers CAAR sont conservées (administrateur). */
export async function saveCaarSinistres(actor: AuthUser, input: { keys: string[]; jusqua: string; dossiers: number }): Promise<ActionResult<true>> {
  const guard = requireAdmin(actor);
  if (!guard.success) return guard;
  try {
    await write(KEY_SIN, { keys: input.keys, jusqua: input.jusqua, dossiers: input.dossiers, maj: todayIso() });
    await logAction(actor, "Régul CAAR : base activité mise à jour", `${input.dossiers} dossiers`, true);
    return ok(true);
  } catch (error) {
    console.error("[caar-regul] sinistres :", error);
    return fail("La base activité n'a pas pu être enregistrée.", "DATABASE");
  }
}
