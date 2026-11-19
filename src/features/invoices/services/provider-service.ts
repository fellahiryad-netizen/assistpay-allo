import { db } from "@/lib/db";
import { can, requireAccess } from "@/features/access/services/access-rules";
import type { AuthUser } from "@/features/access/types";
import { activityOf, buildActivityHints } from "@/features/invoices/lib/activity";
import { aggregateProviders, type ProviderAggregation, type ProviderBalance, type ProviderContribution } from "@/features/invoices/lib/provider-activity";
import { remaining, toPayable } from "@/features/invoices/services/invoice-balance";
import { fail, ok, type ActionResult } from "@/types";
import { daysBetween, todayIso } from "@/utils/dates";

export type { ProviderBalance } from "@/features/invoices/lib/provider-activity";

/** Soldes des prestataires : vue globale (`items`, `due`, `pending`) et même vue séparée par activité (`activities`). */
export interface ProviderBalancesResult extends ProviderAggregation {
  canEdit: boolean;
  years: number[];
}

/**
 * Soldes des prestataires : facturé, réglé, reste à payer, nombre de factures impayées et plus ancienne.
 * Les montants viennent de `toPayable` / `remaining` ; chaque facture est ensuite rangée dans son activité (`activityOf`).
 */
export async function providerBalances(actor: AuthUser, query: { q?: string; year?: number }): Promise<ActionResult<ProviderBalancesResult>> {
  const guard = requireAccess(actor, "PREST");
  if (!guard.success) return guard;
  const supplier = requireAccess(actor, "FFOUR");
  if (!supplier.success) return supplier;
  const rows = await db.invoice.findMany({ where: { sens: "DEBIT", status: { not: "ANNULE" }, ...(can(actor, "RH") ? {} : { payroll: false }) } });
  const today = todayIso();
  const years = [...new Set(rows.flatMap((row) => (row.annee ? [row.annee] : [])))].sort((a, b) => b - a);
  const hints = buildActivityHints(rows.filter((row) => !row.payroll));
  const contributions: ProviderContribution[] = [];
  for (const row of rows) {
    if (row.payroll || /charges de personnel/i.test(row.categorie)) continue;
    if (query.year && row.annee !== query.year) continue;
    const invoice = toPayable(row);
    const name = invoice.tiers.trim() || "Sans nom";
    if (query.q && !name.toLowerCase().includes(query.q.toLowerCase())) continue;
    const activity = activityOf({ categorie: row.categorie, extra: row.extra, nature: row.nature, tiers: row.tiers, libelle: row.libelle }, hints);
    if (invoice.status === "REGLE") {
      contributions.push({ activity, tiers: name, invoiced: invoice.montant, paid: invoice.montant, due: 0, pending: 0, oldestDays: 0, lastPaid: invoice.dateOperation ?? null });
    } else {
      const reste = remaining(invoice);
      const since = invoice.dateFacture ?? invoice.dateOperation;
      contributions.push({ activity, tiers: name, invoiced: invoice.montant, paid: invoice.montant - reste, due: reste, pending: 1, oldestDays: since ? daysBetween(since, today) : 0, lastPaid: null });
    }
  }
  const aggregation = aggregateProviders(contributions);
  if (aggregation.items.length === 0 && rows.length === 0) return fail("Aucune facture fournisseur.", "NOT_FOUND");
  return ok({ ...aggregation, canEdit: can(actor, "FFOUR", "EDIT"), years });
}
