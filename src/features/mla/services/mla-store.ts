import { randomUUID } from "node:crypto";
import { requireAccess } from "@/features/access/services/access-rules";
import type { AuthUser } from "@/features/access/types";
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
