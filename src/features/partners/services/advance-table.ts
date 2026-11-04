import { db } from "@/lib/db";
import { writeWorkbook } from "@/lib/spreadsheet";
import { can, requireAccess } from "@/features/access/services/access-rules";
import type { AuthUser } from "@/features/access/types";
import { branchLabel, branchOf } from "@/features/invoices/services/branch";
import { remaining, toPayable } from "@/features/invoices/services/invoice-balance";
import { CAAT_SUCCURSALES } from "@/features/invoices/services/caat-advances";
import { fail, ok, type ActionResult } from "@/types";
import { round2 } from "@/utils/amounts";
import { MONTHS_FR, todayIso } from "@/utils/dates";
import { upperPlain } from "@/utils/text";

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

const MONTH_PREFIXES: ReadonlyArray<[string, number]> = [["JANV", 1], ["JAN", 1], ["FEV", 2], ["MARS", 3], ["AVR", 4], ["MAI", 5], ["JUIN", 6], ["JUIL", 7], ["AOUT", 8], ["SEPT", 9], ["OCT", 10], ["NOV", 11], ["DEC", 12]];
const NOT_MONTHLY = /REGUL|REFACTUR|TRIMESTR|PASSI[FV]|DIRECTION|ANNEXE|LISTE JOINTE/;

/** Mois de production (« AAAA-MM ») d'une facture : champ « période », sinon cité dans le libellé (« AOUT2026 », « Juillet 2026 »…). */
export function productionPeriod(periode: string, libelle: string): string | null {
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(periode)) return periode;
  const text = upperPlain(libelle);
  const named = text.match(/(JANV\w*|JAN|FEV\w*|MARS|AVR\w*|MAI|JUIN|JUIL\w*|AOUT|SEPT\w*|OCT\w*|NOV\w*|DEC\w*)\s*[-/ ]*\s*(20\d\d)/);
  if (named?.[1] && named[2]) {
    const month = MONTH_PREFIXES.find(([prefix]) => named[1]?.startsWith(prefix))?.[1];
    if (month) return `${named[2]}-${String(month).padStart(2, "0")}`;
  }
  const numeric = text.match(/\b(0?[1-9]|1[0-2])\s*\/\s*(20\d\d)\b/);
  return numeric?.[1] && numeric[2] ? `${numeric[2]}-${numeric[1].padStart(2, "0")}` : null;
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
  const heads = MONTHS_FR.map((name) => name.slice(0, 4));
  const block = (title: string, pick: (cell: { billed: number; paid: number; due: number }) => number): Array<Array<string | number | null>> => [
    [title],
    ["Succursale", ...heads, "Hors mois", "Total"],
    ...table.rows.map((row) => [row.label, ...row.months.map((c) => pick(c) || null), pick(row.other) || null, pick(row)]),
    ["TOTAL", ...table.totals.months.map((c) => pick(c) || null), pick(table.totals.other) || null, pick(table.totals)],
    [],
  ];
  const detail: Array<Array<string | number | null>> = [["Succursale", "Mois", "N° facture", "Libellé", "Montant", "Encaissé", "Reste", "Date facture", "Date règlement", "État"]];
  for (const row of table.rows) {
    row.months.forEach((cell, m) => cell.invoices.forEach((inv) => detail.push([row.label, heads[m] ?? "", inv.numero, inv.libelle, inv.montant, inv.paid, round2(inv.montant - inv.paid), inv.dateFacture, inv.dateOperation, inv.status === "REGLE" ? "Réglée" : "En attente"])));
    row.other.invoices.forEach((inv) => detail.push([row.label, "Hors mois", inv.numero, inv.libelle, inv.montant, inv.paid, round2(inv.montant - inv.paid), inv.dateFacture, inv.dateOperation, inv.status === "REGLE" ? "Réglée" : "En attente"]));
  }
  const widths = [26, ...heads.map(() => 14), 14, 16];
  const bytes = writeWorkbook([
    { name: "Facturé", widths, rows: block(`${client} ${year} – montants facturés`, (c) => c.billed) },
    { name: "Encaissé", widths, rows: block(`${client} ${year} – montants encaissés`, (c) => c.paid) },
    { name: "Reste à encaisser", widths, rows: block(`${client} ${year} – reste à encaisser`, (c) => c.due) },
    { name: "Détail", widths: [26, 10, 18, 60, 16, 16, 16, 14, 14, 12], rows: detail },
  ]);
  return ok({ name: `TABLEAU_PAIEMENT_${client}_${year}.xlsx`, bytes });
}
