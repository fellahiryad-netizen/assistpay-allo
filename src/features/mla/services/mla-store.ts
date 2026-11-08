import { randomUUID } from "node:crypto";
import { requireAccess, requireAdmin } from "@/features/access/services/access-rules";
import type { AuthUser } from "@/features/access/types";
import { logAction } from "@/features/journal/services/journal-service";
import { MLA_PARAMS_DEFAUT, type MlaParams } from "@/features/mla/services/mla-engine";
import { db } from "@/lib/db";
import { fail, ok, type ActionResult } from "@/types";

/** Brouillon de facture MLA transmis à l'éditeur de facturation (table « Setting », clé mla:draft:<id>). */
export interface MlaDraftStored {
  rows: Array<Record<string, string>>;
  /** Mois facturé (AAAA-MM) et son libellé. */
  per: string;
  perTxt: string;
  notes: string;
}

const KEY = "mla:draft:";

/** Enregistre le calcul MLA (lignes de la facture) et renvoie son identifiant. Accès « Établir une facture » en modification. */
export async function saveMlaDraft(actor: AuthUser, draft: MlaDraftStored): Promise<ActionResult<{ token: string }>> {
  const guard = requireAccess(actor, "FACT", "EDIT");
  if (!guard.success) return guard;
  if (draft.rows.length < 2 || draft.rows.length > 400) return fail("Le calcul MLA est vide ou trop long.", "VALIDATION");
  try {
    await db.setting.deleteMany({ where: { key: { startsWith: KEY }, updatedAt: { lt: new Date(Date.now() - 7 * 86400000) } } });
    const token = randomUUID();
    await db.setting.create({ data: { key: `${KEY}${token}`, value: draft as unknown as object } });
    return ok({ token });
  } catch (error) {
    console.error("[mla] brouillon impossible :", error);
    return fail("Le calcul n'a pas pu être transmis à la facturation.", "DATABASE");
  }
}

/** Relit un brouillon MLA ; null s'il n'existe plus. */
export async function readMlaDraft(token: string): Promise<MlaDraftStored | null> {
  const row = await db.setting.findUnique({ where: { key: `${KEY}${token}` } });
  const value = row?.value as unknown as MlaDraftStored | undefined;
  return value && Array.isArray(value.rows) ? value : null;
}

const PARAMS_KEY = "mla:params";

/** Primes MLA en vigueur (celles de l'administrateur, sinon les valeurs par défaut). */
export async function getMlaParams(): Promise<MlaParams> {
  try {
    const row = await db.setting.findUnique({ where: { key: PARAMS_KEY } });
    const value = row?.value as Partial<MlaParams> | undefined;
    const annuelle = Number(value?.primeAnnuelle);
    const retrait = Number(value?.primeRetraitMois);
    return { primeAnnuelle: annuelle > 0 ? annuelle : MLA_PARAMS_DEFAUT.primeAnnuelle, primeRetraitMois: retrait > 0 ? retrait : MLA_PARAMS_DEFAUT.primeRetraitMois };
  } catch (error) {
    console.error("[mla] paramètres illisibles :", error);
    return MLA_PARAMS_DEFAUT;
  }
}

/** Enregistre les primes MLA (administrateurs). Elles s'appliquent aux prochaines factures ; les factures établies ne changent pas. */
export async function saveMlaParams(actor: AuthUser, params: MlaParams): Promise<ActionResult<MlaParams>> {
  const guard = requireAdmin(actor);
  if (!guard.success) return guard;
  if (!(params.primeAnnuelle > 0) || !(params.primeRetraitMois > 0)) return fail("Les primes doivent être supérieures à zéro.", "VALIDATION");
  try {
    const before = await getMlaParams();
    await db.setting.upsert({ where: { key: PARAMS_KEY }, create: { key: PARAMS_KEY, value: params as unknown as object }, update: { value: params as unknown as object } });
    await logAction(actor, "Primes MLA modifiées", `par véhicule/an ${before.primeAnnuelle} → ${params.primeAnnuelle} DA ; retrait sinistré/mois ${before.primeRetraitMois} → ${params.primeRetraitMois} DA`, true);
    return ok(params);
  } catch (error) {
    console.error("[mla] enregistrement des primes impossible :", error);
    return fail("Les primes n'ont pas pu être enregistrées.", "DATABASE");
  }
}
