import { db } from "@/lib/db";
import { can, requireAccess } from "@/features/access/services/access-rules";
import type { AuthUser } from "@/features/access/types";
import { remaining, toPayable } from "@/features/invoices/services/invoice-balance";
import { fail, ok, type ActionResult } from "@/types";
import { round2 } from "@/utils/amounts";
import { daysBetween, todayIso } from "@/utils/dates";

/** Solde d'un prestataire (factures fournisseurs). */
export interface ProviderBalance {
  tiers: string;
  invoiced: number;
  paid: number;
  due: number;
  pending: number;
  oldestDays: number;
  lastPaid: string | null;
}

/** Soldes des prestataires : facturé, réglé, reste à payer, nombre de factures impayées et plus ancienne. */
export async function providerBalances(actor: AuthUser, query: { q?: string; year?: number }): Promise<ActionResult<{ items: ProviderBalance[]; due: number; pending: number; canEdit: boolean; years: number[] }>> {
  const guard = requireAccess(actor, "FFOUR");
  if (!guard.success) return guard;
  const rows = await db.invoice.findMany({ where: { sens: "DEBIT", status: { not: "ANNULE" }, ...(can(actor, "RH") ? {} : { payroll: false }) } });
  const today = todayIso();
  const years = [...new Set(rows.flatMap((row) => (row.annee ? [row.annee] : [])))].sort((a, b) => b - a);
  const map = new Map<string, ProviderBalance>();
  for (const row of rows) {
    if (row.payroll || /charges de personnel/i.test(row.categorie)) continue;
    if (query.year && row.annee !== query.year) continue;
    const invoice = toPayable(row);
    const name = invoice.tiers.trim() || "Sans nom";
    if (query.q && !name.toLowerCase().includes(query.q.toLowerCase())) continue;
    const entry = map.get(name) ?? { tiers: name, invoiced: 0, paid: 0, due: 0, pending: 0, oldestDays: 0, lastPaid: null };
    entry.invoiced = round2(entry.invoiced + invoice.montant);
    if (invoice.status === "REGLE") {
      entry.paid = round2(entry.paid + invoice.montant);
      if (invoice.dateOperation && (!entry.lastPaid || invoice.dateOperation > entry.lastPaid)) entry.lastPaid = invoice.dateOperation;
    } else {
      const reste = remaining(invoice);
      entry.due = round2(entry.due + reste);
      entry.paid = round2(entry.paid + (invoice.montant - reste));
      entry.pending += 1;
      const since = invoice.dateFacture ?? invoice.dateOperation;
      if (since) entry.oldestDays = Math.max(entry.oldestDays, daysBetween(since, today));
    }
    map.set(name, entry);
  }
  const items = [...map.values()].sort((a, b) => b.due - a.due || b.invoiced - a.invoiced);
  if (items.length === 0 && rows.length === 0) return fail("Aucune facture fournisseur.", "NOT_FOUND");
  return ok({ items, due: round2(items.reduce((s, i) => s + i.due, 0)), pending: items.reduce((s, i) => s + i.pending, 0), canEdit: can(actor, "FFOUR", "EDIT"), years });
}
