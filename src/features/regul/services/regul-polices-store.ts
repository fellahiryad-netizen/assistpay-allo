import { requireAccess } from "@/features/access/services/access-rules";
import type { AuthUser } from "@/features/access/types";
import { logAction } from "@/features/journal/services/journal-service";
import { REGUL_SUCCURSALES, succId, type BaseRow, type RegulIndex, type RegulSin } from "@/features/regul/services/regul-engine";
import { compterParAgence, croiserPolices, fichierKey, fichierPrefix, filtrerStatut, type AgenceCount, type PoliceStatut, type PolicesSucc, type RegulFichier, type PolicesBlock, type PolicesView, type PolicesQuery } from "@/features/regul/services/regul-polices";
import { db } from "@/lib/db";
import { fail, ok, type ActionResult } from "@/types";
import { todayIso } from "@/utils/dates";

/* Conservation et exploitation des polices des fichiers de régularisation CAAT (réglages « regul:fichier:SUCC:AAAA-MM »). */

async function read<T>(key: string): Promise<T | null> {
  const row = await db.setting.findUnique({ where: { key } });
  return row ? (row.value as T) : null;
}

/** Remplace les polices conservées d'un mois de régularisation (même clé : pas de doublon en cas de rechargement). */
export async function saveFichiers(actor: AuthUser, fichiers: RegulFichier[]): Promise<ActionResult<{ mois: number; lignes: number }>> {
  const guard = requireAccess(actor, "FCLI", "EDIT");
  if (!guard.success) return guard;
  try {
    let lignes = 0;
    for (const f of fichiers) {
      if (!(REGUL_SUCCURSALES as readonly string[]).includes(f.succ)) return fail("Succursale inconnue.", "VALIDATION");
      const key = fichierKey(succId(f.succ), f.annee, f.mois);
      const value = JSON.parse(JSON.stringify({ ...f, maj: todayIso() })) as never;
      await db.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
      lignes += f.rows.length;
      await logAction(actor, "Régul CAAT : polices du fichier conservées", `${f.succ} ${f.annee}-${String(f.mois).padStart(2, "0")} : ${f.rows.length} lignes (${f.fichiers.join(", ")})`);
    }
    return ok({ mois: fichiers.length, lignes });
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
    for (const succ of list) {
      const [base, rows] = await Promise.all([read<BaseRow[]>(`regul:base:${succ}`), db.setting.findMany({ where: { key: { startsWith: fichierPrefix(succId(succ)) } } })]);
      const fichiers = rows.map((row) => row.value as unknown as RegulFichier);
      if (!fichiers.length) {
        sansRegul.push(succ);
        continue;
      }
      const result = filtrerStatut(croiserPolices(succ, base ?? [], fichiers, sinSet, index?.agences ?? {}, { mois: query.mois ? [query.mois] : [], agence: query.agence }), query.statut);
      blocks.push({ result, agences: compterParAgence(result) });
    }
    return ok({ blocks, sinLoaded: Boolean(sinSet), sansRegul });
  } catch (error) {
    console.error("[regul] polices non retrouvées :", error);
    return fail("Le contrôle des polices n'a pas pu être calculé.", "DATABASE");
  }
}
