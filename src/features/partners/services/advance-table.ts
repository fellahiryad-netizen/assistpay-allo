import { db } from "@/lib/db";
import { writePaymentWorkbook, type PaymentInvoiceSpec, type PaymentRowSpec } from "@/lib/spreadsheet";
import { can, requireAccess } from "@/features/access/services/access-rules";
import type { AuthUser } from "@/features/access/types";
import { branchLabel, branchOf } from "@/features/invoices/services/branch";
import { remaining, toPayable } from "@/features/invoices/services/invoice-balance";
import { CAAT_SUCCURSALES } from "@/features/invoices/services/caat-advances";
import { fail, ok, type ActionResult } from "@/types";
import { round2 } from "@/utils/amounts";
import { decimalToNumber } from "@/features/invoices/services/invoice-mapper";
import { MONTHS_FR, toIsoDate, todayIso } from "@/utils/dates";
import { upperPlain } from "@/utils/text";
import { NOT_MONTHLY, productionPeriod } from "@/features/partners/lib/production-period";

export { NOT_MONTHLY, productionPeriod };

/** Clients suivis par succursale. */
export type AdvanceClient = "CAAT" | "CAAR";

/** Facture placée dans le tableau. */
export interface AdvanceInvoice {
  id: string;
  numero: string;
  libelle: string;
  montant: number;
  paid: number;
  status: "EN_ATTENTE" | "REGLE";
  dateFacture: string | null;
  dateOperation: string | null;
  /** Paiements du relevé bancaire reliés à cette facture (visibles avec l'accès au relevé). */
  liens: Array<{ date: string; montant: number; libelle: string }>;
}

/** Case du tableau : une succursale pour un mois. */
export interface AdvanceCell {
  invoices: AdvanceInvoice[];
  billed: number;
  paid: number;
  due: number;
  /** vide : rien ; zero : ligne créée sans montant ; attente ; partiel ; regle. */
  state: "vide" | "zero" | "attente" | "partiel" | "regle";
}

/** Ligne du tableau : une succursale. */
export interface AdvanceRow {
  key: string;
  label: string;
  months: AdvanceCell[];
  /** Factures de l'année qui ne sont pas des avances mensuelles (régularisation, refacturation…). */
  other: AdvanceCell;
  billed: number;
  paid: number;
  due: number;
}

/** Tableau de paiement d'un client pour une année. */
export interface AdvanceTable {
  client: AdvanceClient;
  year: number;
  years: number[];
  rows: AdvanceRow[];
  totals: { months: Array<{ billed: number; paid: number; due: number }>; other: { billed: number; paid: number; due: number }; billed: number; paid: number; due: number };
}

const emptyCell = (): AdvanceCell => ({ invoices: [], billed: 0, paid: 0, due: 0, state: "vide" });

function finish(cell: AdvanceCell): AdvanceCell {
  cell.billed = round2(cell.billed);
  cell.paid = round2(cell.paid);
  cell.due = round2(cell.due);
  if (!cell.invoices.length) cell.state = "vide";
  else if (cell.billed === 0) cell.state = "zero";
  else if (cell.due <= 0.005) cell.state = "regle";
  else if (cell.paid > 0.005) cell.state = "partiel";
  else cell.state = "attente";
  return cell;
}

function add(cell: AdvanceCell, invoice: AdvanceInvoice): void {
  cell.invoices.push(invoice);
  cell.billed += invoice.montant;
  cell.paid += invoice.paid;
  cell.due += Math.max(0, invoice.montant - invoice.paid);
}

const CAAR_ROWS: ReadonlyArray<[string, string]> = [["CHERAGA", "Chéraga (Alger)"], ["BOUZAREAH", "Bouzaréah (Alger)"], ["CONSTANTINE", "Constantine"], ["ANNABA", "Annaba"], ["ORAN", "Oran"]];

/** Tableau succursale × mois des factures CAAT (avances 90 %) ou CAAR : facturé, encaissé, reste à encaisser. */
export async function advanceTable(actor: AuthUser, client: AdvanceClient, year: number): Promise<ActionResult<AdvanceTable>> {
  const guard = requireAccess(actor, "FCLI");
  if (!guard.success) return guard;
  try {
    const rows = await db.invoice.findMany({ where: { sens: "CREDIT", categorie: client, status: { not: "ANNULE" }, payroll: false } });
    const bankLines = can(actor, "RELEVE") ? await db.bankStatementLine.findMany({ where: { sens: "CREDIT", NOT: { invoiceRefs: { isEmpty: true } } }, select: { date: true, montant: true, libelle: true, invoiceRefs: true } }) : [];
    const linksOf = (legacyId: string): AdvanceInvoice["liens"] =>
      bankLines.filter((line) => line.invoiceRefs.some((ref) => ref.split(":")[0] === legacyId)).map((line) => ({ date: toIsoDate(line.date) ?? "", montant: decimalToNumber(line.montant), libelle: line.libelle }));
    const defs: Array<[string, string]> = client === "CAAT" ? CAAT_SUCCURSALES.map((name) => [upperPlain(name), name]) : [...CAAR_ROWS];
    const table = new Map<string, { label: string; months: AdvanceCell[]; other: AdvanceCell }>(defs.map(([key, label]) => [key, { label, months: Array.from({ length: 12 }, emptyCell), other: emptyCell() }]));
    const yearsSeen = new Set<number>([year, Number(todayIso().slice(0, 4))]);
    for (const row of rows) {
      const payable = toPayable(row);
      const rawKey = branchOf({ categorie: row.categorie, succursale: row.succursale, tiers: row.tiers, libelle: row.libelle });
      const label = branchLabel({ categorie: row.categorie, succursale: row.succursale, tiers: row.tiers, libelle: row.libelle });
      const key = rawKey && table.has(rawKey) ? rawKey : table.has(upperPlain(label)) ? upperPlain(label) : "";
      const period = productionPeriod(row.periode, row.libelle);
      const invoiceYear = period ? Number(period.slice(0, 4)) : (payable.dateFacture ?? "").length >= 4 ? Number(payable.dateFacture?.slice(0, 4)) : (row.annee ?? 0);
      if (invoiceYear) yearsSeen.add(invoiceYear);
      if (invoiceYear !== year) continue;
      const bucketKey = key || "AUTRES";
      if (!table.has(bucketKey)) table.set(bucketKey, { label: bucketKey === "AUTRES" ? "Direction / sans succursale" : label || bucketKey, months: Array.from({ length: 12 }, emptyCell), other: emptyCell() });
      const bucket = table.get(bucketKey);
      if (!bucket) continue;
      const paid = payable.status === "REGLE" ? payable.montant : Math.max(0, payable.montant - remaining(payable));
      const entry: AdvanceInvoice = {
        id: row.id,
        numero: row.numero,
        libelle: row.libelle,
        montant: payable.montant,
        paid,
        status: payable.status === "REGLE" ? "REGLE" : "EN_ATTENTE",
        dateFacture: payable.dateFacture,
        dateOperation: payable.dateOperation,
        liens: linksOf(row.legacyId),
      };
      const monthly = Boolean(key) && period !== null && !NOT_MONTHLY.test(upperPlain(row.libelle));
      if (monthly && period) add(bucket.months[Number(period.slice(5, 7)) - 1] ?? bucket.other, entry);
      else add(bucket.other, entry);
    }
    const out: AdvanceRow[] = [...table.entries()]
      .filter(([key, value]) => defs.some(([k]) => k === key) || value.months.some((c) => c.invoices.length) || value.other.invoices.length)
      .map(([key, value]) => {
        const months = value.months.map(finish);
        const other = finish(value.other);
        const all = [...months, other];
        return {
          key,
          label: value.label,
          months,
          other,
          billed: round2(all.reduce((s, c) => s + c.billed, 0)),
          paid: round2(all.reduce((s, c) => s + c.paid, 0)),
          due: round2(all.reduce((s, c) => s + c.due, 0)),
        };
      });
    const sum = (pick: (row: AdvanceRow) => { billed: number; paid: number; due: number }): { billed: number; paid: number; due: number } => ({
      billed: round2(out.reduce((s, r) => s + pick(r).billed, 0)),
      paid: round2(out.reduce((s, r) => s + pick(r).paid, 0)),
      due: round2(out.reduce((s, r) => s + pick(r).due, 0)),
    });
    return ok({
      client,
      year,
      years: [...yearsSeen].sort((a, b) => b - a),
      rows: out,
      totals: { months: Array.from({ length: 12 }, (_, m) => sum((r) => r.months[m] ?? emptyCell())), other: sum((r) => r.other), billed: sum((r) => r).billed, paid: sum((r) => r).paid, due: sum((r) => r).due },
    });
  } catch (error) {
    console.error("[avances] tableau :", error);
    return fail("Le tableau de paiement n'a pas pu être calculé.", "DATABASE");
  }
}

/** Excel du tableau : facturé, encaissé et reste par succursale et par mois, puis le détail des factures. */
export async function exportAdvanceTable(actor: AuthUser, client: AdvanceClient, year: number): Promise<ActionResult<{ name: string; bytes: Uint8Array }>> {
  if (!can(actor, "A_EXPORT", "EDIT")) return fail("Vous n'avez pas le droit d'exporter.", "FORBIDDEN");
  const result = await advanceTable(actor, client, year);
  if (!result.success) return result;
  const table = result.data;
  const monthLabels = ["Janv.", "Févr.", "Mars", "Avr.", "Mai", "Juin", "Juil.", "Août", "Sept.", "Oct.", "Nov.", "Déc."];
  const today = todayIso();
  const dateOf = (value: string | null): Date | null => (value && /^\d{4}-\d{2}-\d{2}/.test(value) ? new Date(`${value.slice(0, 10)}T00:00:00Z`) : null);
  const ageOf = (value: string | null, open: boolean): number | null => {
    const date = dateOf(value);
    return open && date ? Math.max(0, Math.round((new Date(`${today}T00:00:00Z`).getTime() - date.getTime()) / 86_400_000)) : null;
  };
  const invoices: PaymentInvoiceSpec[] = [];
  const push = (branch: string, month: string, nature: string, inv: AdvanceInvoice): void => {
    const open = inv.montant - inv.paid > 0.005;
    invoices.push({ branch, month, nature, numero: inv.numero, libelle: inv.libelle, montant: inv.montant, paid: inv.paid, dateFacture: dateOf(inv.dateFacture), dateOperation: dateOf(inv.dateOperation), ageDays: ageOf(inv.dateFacture, open) });
  };
  const rows: PaymentRowSpec[] = table.rows.map((row) => {
    const label = row.key === "AUTRES" ? "Direction générale / sans succursale" : row.label;
    row.months.forEach((cell, m) => cell.invoices.forEach((inv) => push(label, monthLabels[m] ?? "", "Avance mensuelle", inv)));
    row.other.invoices.forEach((inv) => push(label, "Hors mois", row.key === "AUTRES" ? "Direction générale" : "Régularisation / autre", inv));
    const firstDue = row.months.findIndex((cell) => cell.due > 0.005);
    const pending = [...row.months, row.other].reduce((total, cell) => total + cell.invoices.filter((inv) => inv.montant - inv.paid > 0.005).length, 0);
    return { label, months: row.months.map(({ billed, paid, due }) => ({ billed, paid, due })), other: { billed: row.other.billed, paid: row.other.paid, due: row.other.due }, pending, oldestUnpaid: firstDue >= 0 ? `${MONTHS_FR[firstDue] ?? ""} ${year}` : row.other.due > 0.005 ? "Hors mois" : "" };
  });
  const bytes = await writePaymentWorkbook({ client, year, generatedOn: today.split("-").reverse().join("/"), monthLabels, rows, invoices });
  return ok({ name: `TABLEAU_PAIEMENT_${client}_${year}.xlsx`, bytes });
}
