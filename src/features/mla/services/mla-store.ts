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

/** Création de facture MLA conservée pour la traçabilité. */
export interface MlaHistoryEntry {
  id: string;
  num: string;
  /** Mois facturé (« Octobre 2026 »). */
  mois: string;
  creePar: string;
  creeLe: string;
  ht: number;
  ttc: number;
  /** Véhicules retirés sinistrés facturés. */
  retraits: number;
  vehicules: string;
  rectifiee: number;
  /** Dernier modificateur (rectification) ; vide si jamais modifiée. */
  modifiePar: string;
  statut: string;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Historique des factures MLA établies (depuis l'onglet ou l'éditeur), plus récentes d'abord. */
export async function listMlaHistory(actor: AuthUser): Promise<ActionResult<MlaHistoryEntry[]>> {
  const guard = requireAccess(actor, "FACT");
  if (!guard.success) return guard;
  try {
    const docs = await db.issuedInvoice.findMany({ where: { payload: { path: ["preset"], equals: "m_mla" } }, orderBy: { createdAt: "desc" }, take: 60 });
    const legacyIds = docs.map((doc) => doc.invoiceLegacyId).filter((id): id is string => Boolean(id));
    const invoices = await db.invoice.findMany({ where: { legacyId: { in: legacyIds } }, select: { legacyId: true, status: true } });
    const status = new Map(invoices.map((invoice) => [invoice.legacyId, invoice.status]));
    return ok(
      docs.map((doc) => {
        const payload = (doc.payload ?? {}) as Record<string, unknown>;
        const rows = Array.isArray(payload.rows) ? (payload.rows as Array<Record<string, string>>) : [];
        const cree = (payload.cree ?? {}) as Record<string, unknown>;
        const maj = (payload.maj ?? {}) as Record<string, unknown>;
        const rectifiee = Number(payload.rectifiee ?? 0) || 0;
        return {
          id: doc.id,
          num: doc.num,
          mois: str(payload.perTxt),
          creePar: str(cree.nom),
          creeLe: str(cree.le) || doc.createdAt.toISOString(),
          ht: Number(doc.ht),
          ttc: Number(doc.ttc),
          retraits: rows.slice(2).filter((row) => !row.info && row.des).length,
          vehicules: str(rows[0]?.qte),
          rectifiee,
          modifiePar: rectifiee > 0 ? str(maj.nom) : "",
          statut: (doc.invoiceLegacyId ? status.get(doc.invoiceLegacyId) : "") ?? "",
        };
      }),
    );
  } catch (error) {
    console.error("[mla] historique illisible :", error);
    return fail("L'historique des factures MLA n'a pas pu être lu.", "DATABASE");
  }
}
