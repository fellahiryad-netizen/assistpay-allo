import { db } from "@/lib/db";
import type { AuthUser } from "@/features/access/types";
import { classify, type Classification, type ClassifiableRow } from "@/features/invoices/lib/classification";
import type { InvoiceQuery } from "@/features/invoices/schemas";
import { decimalToNumber } from "@/features/invoices/services/invoice-mapper";
import { buildInvoiceWhereWithBranch } from "@/features/invoices/services/invoice-service";
import { PARTNER_GROUPS } from "@/features/partners/services/partner-service";
import { fail, ok, type ActionResult } from "@/types";
import { toIsoDate, todayIso } from "@/utils/dates";

/**
 * Classement simple de la liste des factures partenaires (crédit) ou fournisseurs (débit) :
 * onglets de statut, barre Partenaire / Fournisseur et barre Mois, avec compteurs et totaux.
 * Lecture seule : les montants sont ceux de la facture, rien n'est recalculé.
 * `useDefaultMonth` applique le mois courant (ou le dernier mois utile) quand l'URL n'en précise aucun.
 */
export async function getInvoiceClassification(
  actor: AuthUser,
  query: Omit<InvoiceQuery, "page">,
  useDefaultMonth: boolean,
): Promise<ActionResult<Classification>> {
  if (!query.sens) return fail("Le classement demande de choisir partenaires ou fournisseurs.", "VALIDATION");
  const base = await buildInvoiceWhereWithBranch(actor, { ...query, status: undefined, p: undefined, mois: undefined });
  if (!base) return fail("Vous n'avez accès à aucune facture.", "FORBIDDEN");
  try {
    const rows = await db.invoice.findMany({
      where: { AND: [base, { origine: { not: "rh" } }] },
      select: { status: true, categorie: true, tiers: true, dateFacture: true, dateOperation: true, montant: true },
    });
    const items: ClassifiableRow[] = rows.map((row) => ({
      status: row.status,
      categorie: row.categorie,
      tiers: row.tiers,
      dateFacture: toIsoDate(row.dateFacture),
      dateOperation: toIsoDate(row.dateOperation),
      montant: decimalToNumber(row.montant),
    }));
    return ok(
      classify(items, {
        sens: query.sens,
        status: query.status,
        p: query.p,
        mois: query.mois,
        useDefaultMonth,
        currentMonth: todayIso().slice(0, 7),
        groups: PARTNER_GROUPS,
      }),
    );
  } catch (error) {
    console.error("[invoices] classement impossible :", error);
    return fail("Le classement n'a pas pu être chargé.", "DATABASE");
  }
}
