import { db } from "@/lib/db";
import { can, requireAccess } from "@/features/access/services/access-rules";
import type { AuthUser } from "@/features/access/types";
import type { BdgQuery, SettlePartInput } from "@/features/bdg/schemas";
import type { BdgInvoiceDTO, BdgSummary } from "@/features/bdg/types";
import { isSplit, paidSum, paymentOptions, remaining, settle, toPayable } from "@/features/invoices/services/invoice-balance";
import { writeExtra } from "@/features/invoices/services/invoice-extra";
import { logAction } from "@/features/journal/services/journal-service";
import { fail, ok, type ActionResult } from "@/types";
import { round2 } from "@/utils/amounts";
import { fromIsoDate } from "@/utils/dates";
import { formatDA } from "@/utils/format";

function dateOf(value: string | boolean | undefined): string | null {
  return typeof value === "string" && value ? value.slice(0, 10) : value === true ? "oui" : null;
}

/** Factures BDG (débours et frais de gestion) avec les montants restant à encaisser. */
export async function listBdg(actor: AuthUser, query: BdgQuery): Promise<ActionResult<{ items: BdgInvoiceDTO[]; summary: BdgSummary; categories: string[]; canEdit: boolean }>> {
  const guard = requireAccess(actor, "BDG");
  if (!guard.success) return guard;
  const rows = await db.invoice.findMany({ where: { sens: "CREDIT", categorie: { contains: "BDG", mode: "insensitive" } }, orderBy: [{ annee: "desc" }, { dateFacture: "desc" }] });
  const all = rows.map(toPayable);
  const categories = [...new Set(all.map((invoice) => invoice.categorie || "Sans catégorie"))].sort();
  const base = all.filter((invoice) => !query.categorie || (invoice.categorie || "Sans catégorie") === query.categorie);
  const open = base.filter((invoice) => invoice.status === "EN_ATTENTE");
  const splitOpen = open.filter(isSplit);
  const summary: BdgSummary = {
    deboursDue: round2(splitOpen.reduce((sum, invoice) => sum + (invoice.extra.regDebours ? 0 : invoice.debours), 0)),
    fraisDue: round2(splitOpen.reduce((sum, invoice) => sum + (invoice.extra.regFrais ? 0 : invoice.frais), 0)),
    unsplitAmount: round2(open.filter((invoice) => !isSplit(invoice)).reduce((sum, invoice) => sum + invoice.montant, 0)),
    unsplitCount: open.filter((invoice) => !isSplit(invoice)).length,
    partialCount: open.filter((invoice) => (isSplit(invoice) && (Boolean(invoice.extra.regDebours) || Boolean(invoice.extra.regFrais))) || (!isSplit(invoice) && paidSum(invoice) > 0)).length,
  };
  const filtered = base.filter((invoice) => (query.etat === "ouvert" ? invoice.status === "EN_ATTENTE" : query.etat === "tous" ? true : invoice.status === query.etat));
  return ok({
    items: filtered.slice(0, 300).map((invoice) => ({
      id: invoice.id,
      numero: invoice.numero,
      categorie: invoice.categorie,
      tiers: invoice.tiers,
      succursale: invoice.succursale,
      periode: rows.find((row) => row.id === invoice.id)?.periode ?? "",
      libelle: invoice.libelle,
      status: invoice.status,
      montant: invoice.montant,
      split: isSplit(invoice),
      debours: invoice.debours,
      frais: invoice.frais,
      factureDebours: invoice.extra.factureDebours ?? "",
      factureFrais: invoice.extra.factureFrais ?? "",
      regDebours: dateOf(invoice.extra.regDebours),
      regFrais: dateOf(invoice.extra.regFrais),
      remaining: remaining(invoice),
      partial: isSplit(invoice) && (Boolean(invoice.extra.regDebours) || Boolean(invoice.extra.regFrais)) && invoice.status === "EN_ATTENTE",
    })),
    summary,
    categories,
    canEdit: can(actor, "BDG", "EDIT") && can(actor, "FCLI", "EDIT"),
  });
}

/** Règle les débours, les frais de gestion ou toute la facture BDG (la facture est soldée quand les deux le sont). */
export async function settleBdgPart(actor: AuthUser, input: SettlePartInput): Promise<ActionResult<{ settled: boolean }>> {
  const guard = requireAccess(actor, "BDG", "EDIT");
  if (!guard.success) return guard;
  const invoiceGuard = requireAccess(actor, "FCLI", "EDIT");
  if (!invoiceGuard.success) return invoiceGuard;
  const row = await db.invoice.findUnique({ where: { id: input.id } });
  if (!row) return fail("Facture introuvable.", "NOT_FOUND");
  const invoice = toPayable(row);
  if (!paymentOptions(invoice, new Set()).some((option) => option.part === input.part)) return fail("Cette partie est déjà réglée.", "CONFLICT");
  const change = settle(invoice, input.part, { date: input.date, mode: input.mode, numero: input.reference });
  await db.invoice.update({
    where: { id: row.id },
    data: { status: change.status, dateOperation: fromIsoDate(change.dateOperation), mode: change.mode, cheque: change.cheque, extra: writeExtra(change.extra), updatedById: actor.id },
  });
  const amount = input.part === "debours" ? invoice.debours : input.part === "frais" ? invoice.frais : remaining(invoice);
  await logAction(actor, input.part === "debours" ? "Débours BDG réglés" : input.part === "frais" ? "Frais de gestion BDG réglés" : "Règlement facture", `${invoice.numero || invoice.tiers} – ${formatDA(amount)}${change.status === "REGLE" ? " – facture soldée" : ""}`);
  return ok({ settled: change.status === "REGLE" });
}
