import { db } from "@/lib/db";
import { decimalToNumber } from "@/features/invoices/services/invoice-mapper";
import { fromIsoDate, toIsoDate } from "@/utils/dates";

/** Une facture réglée par un virement cumulé. */
export interface CumulPartDTO {
  numero: string;
  tiers: string;
  montant: number;
}

/** Virement cumulé : une ligne du relevé qui règle plusieurs factures à la fois. */
export interface CumulInfo {
  lineId: string;
  date: string;
  montant: number;
  parts: CumulPartDTO[];
}

const PARTS = ["tout", "debours", "frais"] as const;
const baseOf = (ref: string): string => ref.split(":")[0] ?? "";
const isInvoiceRef = (ref: string): boolean => baseOf(ref) !== "" && !baseOf(ref).startsWith("rh");

/** Références distinctes de factures d'une ligne (hors paie). */
export function invoiceBases(refs: readonly string[]): string[] {
  return [...new Set(refs.filter(isInvoiceRef).map(baseOf))];
}

/** Identifiants des lignes du relevé rapprochées à plusieurs factures (virements cumulés). */
export async function cumulLineIds(): Promise<string[]> {
  const rows = await db.bankStatementLine.findMany({ where: { invoiceRefs: { isEmpty: false } }, select: { id: true, invoiceRefs: true } });
  return rows.filter((row) => invoiceBases(row.invoiceRefs).length >= 2).map((row) => row.id);
}

/** Détail des virements cumulés de lignes données (clé : id de la ligne). */
export async function cumulForLines(lines: ReadonlyArray<{ id: string; date: Date; montant: { toNumber(): number }; invoiceRefs: string[] }>): Promise<Map<string, CumulInfo>> {
  const out = new Map<string, CumulInfo>();
  const multi = lines.filter((line) => invoiceBases(line.invoiceRefs).length >= 2);
  if (multi.length === 0) return out;
  const legacyIds = [...new Set(multi.flatMap((line) => invoiceBases(line.invoiceRefs)))];
  const invoices = await db.invoice.findMany({ where: { legacyId: { in: legacyIds } }, select: { legacyId: true, numero: true, tiers: true, montant: true } });
  const byLegacy = new Map(invoices.map((invoice) => [invoice.legacyId, invoice]));
  for (const line of multi) {
    const parts = invoiceBases(line.invoiceRefs).map((legacyId) => {
      const invoice = byLegacy.get(legacyId);
      return { numero: invoice?.numero || "sans n°", tiers: invoice?.tiers ?? "", montant: invoice ? decimalToNumber(invoice.montant) : 0 };
    });
    out.set(line.id, { lineId: line.id, date: toIsoDate(line.date) ?? "", montant: decimalToNumber(line.montant), parts });
  }
  return out;
}

/**
 * Virements du relevé (crédits ou débits) au montant cherché qui règlent plusieurs factures : références des factures et une note par virement.
 * `date` (AAAA-MM-JJ) restreint à la date de réception du virement.
 */
export async function cumulForAmount(range: { lo: number; hi: number }, date?: string): Promise<{ legacyIds: string[]; notes: string[] }> {
  const lines = await db.bankStatementLine.findMany({
    where: { montant: { gte: range.lo / 100 - 0.005, lte: range.hi / 100 + 0.005 }, invoiceRefs: { isEmpty: false }, ...(date ? { date: fromIsoDate(date) ?? undefined } : {}) },
    select: { id: true, date: true, montant: true, invoiceRefs: true },
    orderBy: { date: "desc" },
    take: 20,
  });
  const infos = await cumulForLines(lines);
  const legacyIds: string[] = [];
  const notes: string[] = [];
  for (const line of lines) {
    const info = infos.get(line.id);
    if (!info) continue;
    legacyIds.push(...invoiceBases(line.invoiceRefs));
    notes.push(`Virement reçu le ${info.date.split("-").reverse().join("/")} de ${info.montant.toLocaleString("fr-FR", { minimumFractionDigits: 2 })} DA : ${info.parts.map((part) => part.numero).join(" + ")}`);
  }
  return { legacyIds, notes };
}

/** Virement cumulé de chaque facture donnée (clé : legacyId de la facture), s'il y en a un. */
export async function cumulForInvoices(legacyIds: readonly string[]): Promise<Map<string, CumulInfo>> {
  const out = new Map<string, CumulInfo>();
  if (legacyIds.length === 0) return out;
  const refs = legacyIds.flatMap((id) => PARTS.map((part) => `${id}:${part}`));
  const lines = await db.bankStatementLine.findMany({ where: { invoiceRefs: { hasSome: refs } }, select: { id: true, date: true, montant: true, invoiceRefs: true } });
  const infos = await cumulForLines(lines);
  for (const line of lines) {
    const info = infos.get(line.id);
    if (!info) continue;
    for (const base of invoiceBases(line.invoiceRefs)) if (legacyIds.includes(base)) out.set(base, info);
  }
  return out;
}
