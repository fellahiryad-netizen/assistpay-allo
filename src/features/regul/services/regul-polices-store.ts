import { requireAccess } from "@/features/access/services/access-rules";
import type { AuthUser } from "@/features/access/types";
import { logAction } from "@/features/journal/services/journal-service";
import { REGUL_SUCCURSALES, succId, type BaseRow, type RegulIndex, type RegulSin } from "@/features/regul/services/regul-engine";
import { compterParAgence, croiserPolices, fichierKey, fichierPrefix, filtrerStatut, fusionnerFichier, lireFichier, type RegulFichier, type PolicesBlock, type PolicesView, type PolicesQuery } from "@/features/regul/services/regul-polices";
import { db } from "@/lib/db";
import { fail, ok, type ActionResult } from "@/types";
import { todayIso } from "@/utils/dates";

/* Conservation et exploitation des polices des fichiers de régularisation CAAT (réglages « regul:fichier:SUCC:AAAA-MM »). */

async function read<T>(key: string): Promise<T | null> {
  const row = await db.setting.findUnique({ where: { key } });
  return row ? (row.value as T) : null;
}

/** Plafond de lignes conservées pour un mois (tous lots confondus). */
const MAX_LIGNES_MOIS = 200000;

/** Résultat de la conservation : lignes reçues et fichiers déjà conservés (non rechargés) du même mois. */
export interface FichiersSaved {
  mois: number;
  lignes: number;
  conserves: string[];
}

/**
 * Conserve les polices d'un mois de régularisation. Fusion par nom de fichier avec l'enregistrement existant (même clé) :
 * les fichiers rechargés sont remplacés, les autres conservés. `suite` : lot suivant d'un même chargement (complète sans rien remplacer).
 */
export async function saveFichiers(actor: AuthUser, fichiers: RegulFichier[], opts: { suite?: boolean } = {}): Promise<ActionResult<FichiersSaved>> {
  const guard = requireAccess(actor, "FCLI", "EDIT");
  if (!guard.success) return guard;
  try {
    let lignes = 0;
    const conserves: string[] = [];
    const perdus: string[] = [];
    for (const f of fichiers) {
      if (!(REGUL_SUCCURSALES as readonly string[]).includes(f.succ)) return fail("Succursale inconnue.", "VALIDATION");
      const key = fichierKey(succId(f.succ), f.annee, f.mois);
      const existing = lireFichier(await read<unknown>(key));
      const fusion = fusionnerFichier(existing, f, Boolean(opts.suite));
      if (fusion.fichier.rows.length > MAX_LIGNES_MOIS) return fail("Trop de lignes de polices pour un même mois.", "VALIDATION");
      const value = JSON.parse(JSON.stringify({ ...fusion.fichier, maj: todayIso() })) as never;
      await db.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
      lignes += f.rows.length;
      conserves.push(...fusion.conserves);
      perdus.push(...fusion.perdus);
      await logAction(actor, "Régul CAAT : polices du fichier conservées", `${f.succ} ${f.annee}-${String(f.mois).padStart(2, "0")} : ${f.rows.length} lignes (${f.fichiers.join(", ")})${opts.suite ? " [suite]" : ""}${fusion.conserves.length ? `, conservés : ${fusion.conserves.join(", ")}` : ""}${fusion.perdus.length ? `, non conservables (ancien format) : ${fusion.perdus.join(", ")}` : ""}`);
    }
    return ok({ mois: fichiers.length, lignes, conserves: [...new Set([...conserves, ...perdus.map((n) => `${n} (ancien format, à recharger)`)])] });
  } catch (error) {
    console.error("[regul] polices conservées :", error);
    return fail("Les polices du fichier de régularisation n'ont pas pu être conservées.", "DATABASE");
  }
}

/** Croise, pour une succursale (ou toutes), la base 90 % et les polices de régularisation conservées. Lecture seule. */
export async function regulPolices(actor: AuthUser, query: PolicesQuery): Promise<ActionResult<PolicesView>> {
  const guard = requireAccess(actor, "FCLI");
  if (!guard.success) return guard;
  const list = query.succ ? [query.succ] : [...REGUL_SUCCURSALES];
  if (list.some((s) => !(REGUL_SUCCURSALES as readonly string[]).includes(s))) return fail("Succursale inconnue.", "VALIDATION");
  try {
    const [sin, index] = await Promise.all([read<RegulSin>("regul:sinistres"), read<RegulIndex>("regul:index")]);
    const sinSet = sin ? new Set(sin.keys) : null;
    const blocks: PolicesBlock[] = [];
    const sansRegul: string[] = [];
    const anciennes: string[] = [];
    for (const succ of list) {
      const [base, rows] = await Promise.all([read<BaseRow[]>(`regul:base:${succ}`), db.setting.findMany({ where: { key: { startsWith: fichierPrefix(succId(succ)) } } })]);
      const fichiers: RegulFichier[] = [];
      let ignores = 0;
      for (const row of rows) {
        const f = lireFichier(row.value);
        if (f) fichiers.push(f);
        else ignores++;
      }
      if (ignores) anciennes.push(succ);
      if (!fichiers.length) {
        sansRegul.push(succ);
        continue;
      }
      const result = filtrerStatut(croiserPolices(succ, base ?? [], fichiers, sinSet, index?.agences ?? {}, { mois: query.mois ? [query.mois] : [], agence: query.agence }), query.statut);
      blocks.push({ result, agences: compterParAgence(result) });
    }
    return ok({ blocks, sinLoaded: Boolean(sinSet), sansRegul, anciennes });
  } catch (error) {
    console.error("[regul] polices non retrouvées :", error);
    return fail("Le contrôle des polices n'a pas pu être calculé.", "DATABASE");
  }
}
