import { db } from "@/lib/db";
import { writeWorkbook } from "@/lib/spreadsheet";
import { can, requireAccess } from "@/features/access/services/access-rules";
import type { AuthUser } from "@/features/access/types";
import { paidSum, remaining, toPayable, type PayableInvoice } from "@/features/invoices/services/invoice-balance";
import { decimalToNumber } from "@/features/invoices/services/invoice-mapper";
import { logAction } from "@/features/journal/services/journal-service";
import type { PartnerQuery } from "@/features/partners/schemas";
import { FORECAST_BUCKETS, type BranchStats, type ForecastBucket, type PartnerDetail, type PartnerForecast, type PartnerInvoice, type PartnerStats } from "@/features/partners/types";
import { fail, ok, type ActionResult } from "@/types";
import { round2 } from "@/utils/amounts";
import { daysBetween, dayGap, shiftIsoDate, todayIso } from "@/utils/dates";
import { formatDA } from "@/utils/format";
import { upperPlain } from "@/utils/text";

/** Regroupement des catégories par partenaire (repris de l'ancienne version). */
export const PARTNER_GROUPS: Readonly<Record<string, readonly string[]>> = {
  GAM: ["GAM", "Honoraire GAM", "Refacturation GAM"],
  "GAM BDG": ["GAM BDG"],
  CAAT: ["CAAT"],
  "CAAT BDG": ["BDG CAAT"],
  TRUST: ["TRUST", "TRUST ASSURANCE"],
  "TRUST BDG": ["Trust BDG"],
  MLA: ["MLA"],
  CAAR: ["CAAR"],
};

const MONTH_PREFIXES: ReadonlyArray<[string, number]> = [["JANV", 1], ["FEV", 2], ["MARS", 3], ["AVR", 4], ["MAI", 5], ["JUIN", 6], ["JUIL", 7], ["AOUT", 8], ["SEPT", 9], ["OCT", 10], ["OCOB", 10], ["NOV", 11], ["DEC", 12]];
const CAAR_BRANCHES = ["Cheraga", "Bouzareah", "Constantine", "Annaba", "Oran"];

/** Partenaire d'une facture client. */
export function partnerKey(categorie: string): string {
  for (const [key, categories] of Object.entries(PARTNER_GROUPS)) if (categories.includes(categorie)) return key;
  return categorie || "Sans catégorie";
}

/** Succursale d'une facture (champ succursale, sinon déduite du libellé ; succursales CAAR reconnues). */
export function branchOf(invoice: Pick<PayableInvoice, "categorie" | "succursale" | "tiers" | "libelle">): string {
  if (invoice.categorie === "CAAR") {
    const text = upperPlain(`${invoice.succursale} ${invoice.tiers} ${invoice.libelle}`);
    const found = CAAR_BRANCHES.find((name) => text.includes(upperPlain(name)) || (name === "Bouzareah" && /BOUZAR/.test(text)) || (name === "Cheraga" && /CHERAGA|CHERAGHA/.test(text)));
    if (found) return upperPlain(found);
  }
  let value = invoice.succursale;
  if (!value) {
    const match = invoice.libelle.match(/succursale[\s\-–_/:]*([A-Za-zÀ-ÿ]+(?:[\s-]?(?:I{1,3}|\d{1,3}))?)/i);
    value = match?.[1] ?? "";
  }
  return upperPlain(value.replace(/^succursale\s*/i, ""))
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b111\b/, "III")
    .replace(/\b11\b/, "II")
    .replace(/\b0?1\b/, "I");
}

/** Date de facture, ou date estimée (1er du mois suivant la période citée dans le libellé). */
export function invoiceDate(invoice: Pick<PayableInvoice, "dateFacture" | "libelle"> & { periode?: string }): { date: string; estimated: boolean } | null {
  if (invoice.dateFacture) return { date: invoice.dateFacture, estimated: false };
  const text = upperPlain(`${invoice.periode ?? ""} ${invoice.libelle}`);
  let month = 0;
  let year = 0;
  const named = text.match(/(JANV\w*|FEV\w*|MARS|AVR\w*|MAI|JUIN|JUIL\w*|AOUT|SEPT\w*|OC\w*|NOV\w*|DEC\w*)\s*[-/ ]*\s*(20\d\d)/);
  if (named?.[1] && named[2]) {
    year = Number(named[2]);
    month = MONTH_PREFIXES.find(([prefix]) => named[1]?.startsWith(prefix))?.[1] ?? 0;
  } else {
    const numeric = text.match(/\b(0?[1-9]|1[0-2])\s*\/\s*(20\d\d)\b/);
    if (numeric?.[1] && numeric[2]) {
      month = Number(numeric[1]);
      year = Number(numeric[2]);
    }
  }
  if (!month || !year) return null;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  return { date: `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`, estimated: true };
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[middle] ?? null) : Math.round(((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2);
}

const collected = (invoice: PayableInvoice): number => (invoice.status === "REGLE" ? invoice.montant : Math.max(0, invoice.montant - remaining(invoice)));

interface CreditRow extends PayableInvoice {
  periode: string;
  annee: number | null;
  mode: string;
}

async function creditRows(): Promise<CreditRow[]> {
  const rows = await db.invoice.findMany({ where: { sens: "CREDIT", status: { not: "ANNULE" }, payroll: false } });
  return rows
    .filter((row) => !/charges de personnel/i.test(row.categorie))
    .map((row) => ({ ...toPayable(row), periode: row.periode, annee: row.annee, mode: row.mode ?? "" }));
}

function statsOf(key: string, rows: CreditRow[], year: number | "all", today: string): PartnerStats {
  const inYear = rows.filter((row) => year === "all" || row.annee === year);
  const pending = rows.filter((row) => row.status === "EN_ATTENTE");
  const delays: number[] = [];
  for (const row of rows) {
    if (row.status !== "REGLE" || !row.dateOperation) continue;
    const date = invoiceDate(row);
    if (date && row.dateOperation >= date.date) {
      const gap = dayGap(date.date, row.dateOperation);
      if (gap < 400) delays.push(gap);
    }
  }
  let oldest = 0;
  let noDate = 0;
  for (const row of pending) {
    const date = invoiceDate(row);
    if (date) oldest = Math.max(oldest, daysBetween(date.date, today));
    else noDate += 1;
  }
  return {
    key,
    invoiced: round2(inYear.reduce((sum, row) => sum + row.montant, 0)),
    collected: round2(inYear.reduce((sum, row) => sum + collected(row), 0)),
    balance: round2(pending.reduce((sum, row) => sum + remaining(row), 0)),
    pending: pending.length,
    medianDelay: median(delays),
    oldestDays: oldest,
    noDate,
  };
}

/**
 * Partenaires : facturé et encaissé de l'année, solde dû (toutes années), délai médian de paiement,
 * plus ancien impayé ; prévision des encaissements selon le délai réel de chaque partenaire (60 jours par défaut).
 */
export async function partnersOverview(actor: AuthUser, year: number | "all"): Promise<ActionResult<{ partners: PartnerStats[]; forecast: PartnerForecast }>> {
  const guard = requireAccess(actor, "PART");
  if (!guard.success) return guard;
  const today = todayIso();
  const rows = await creditRows();
  const groups = new Map<string, CreditRow[]>();
  for (const row of rows) groups.set(partnerKey(row.categorie), [...(groups.get(partnerKey(row.categorie)) ?? []), row]);
  const known = new Set(Object.keys(PARTNER_GROUPS));
  const partners = [...groups.entries()]
    .map(([key, list]) => statsOf(key, list, year, today))
    .filter((stats) => known.has(stats.key) || stats.balance > 0.5)
    .sort((a, b) => b.balance - a.balance || b.invoiced - a.invoiced);
  const empty = (): Record<ForecastBucket, number> => Object.fromEntries(FORECAST_BUCKETS.map(([key]) => [key, 0])) as Record<ForecastBucket, number>;
  const forecast: PartnerForecast = { totals: empty(), byPartner: {} };
  for (const stats of partners) {
    const bucket = empty();
    const delay = stats.medianDelay ?? 60;
    for (const row of (groups.get(stats.key) ?? []).filter((entry) => entry.status === "EN_ATTENTE")) {
      const value = remaining(row);
      const date = invoiceDate(row);
      let key: ForecastBucket = "inc";
      if (date) {
        const left = daysBetween(today, shiftIsoDate(date.date, delay));
        key = left < 0 ? "retard" : left <= 30 ? "s30" : left <= 60 ? "s60" : left <= 90 ? "s90" : "plus";
      }
      bucket[key] = round2(bucket[key] + value);
      forecast.totals[key] = round2(forecast.totals[key] + value);
    }
    forecast.byPartner[stats.key] = bucket;
  }
  return ok({ partners, forecast });
}

/** Fiche d'un partenaire : succursales, factures, relances envoyées. */
export async function partnerDetail(actor: AuthUser, query: PartnerQuery): Promise<ActionResult<PartnerDetail & { canEdit: boolean }>> {
  const guard = requireAccess(actor, "PART");
  if (!guard.success) return guard;
  const today = todayIso();
  const rows = (await creditRows()).filter((row) => partnerKey(row.categorie) === query.key);
  if (!rows.length) return fail("Partenaire introuvable.", "NOT_FOUND");
  const branches = new Map<string, { rows: CreditRow[] }>();
  for (const row of rows) {
    const name = branchOf(row) || "—";
    branches.set(name, { rows: [...(branches.get(name)?.rows ?? []), row] });
  }
  const branchStats: BranchStats[] = [...branches.entries()]
    .map(([name, entry]) => {
      const stats = statsOf(name, entry.rows, query.annee, today);
      return { name, invoiced: stats.invoiced, collected: stats.collected, balance: stats.balance, pending: stats.pending, medianDelay: stats.medianDelay };
    })
    .sort((a, b) => b.balance - a.balance);
  const filtered = rows
    .filter((row) => (!query.succ || branchOf(row) === query.succ) && (row.status === "EN_ATTENTE" || query.annee === "all" || row.annee === query.annee))
    .sort((a, b) => Number(b.status === "EN_ATTENTE") - Number(a.status === "EN_ATTENTE") || (invoiceDate(b)?.date ?? "").localeCompare(invoiceDate(a)?.date ?? ""));
  const invoices: PartnerInvoice[] = filtered.slice(0, 400).map((row) => {
    const date = invoiceDate(row);
    return {
      id: row.id,
      numero: row.numero,
      succursale: branchOf(row),
      libelle: row.libelle,
      factureDate: date?.date ?? null,
      estimated: date?.estimated ?? false,
      montant: row.montant,
      remaining: remaining(row),
      status: row.status === "EN_ATTENTE" && paidSum(row) > 0 ? "PARTIEL" : row.status,
      dateOperation: row.dateOperation,
      mode: row.mode,
      cheque: row.cheque,
      delayDays: row.status === "REGLE" && date && row.dateOperation ? dayGap(date.date, row.dateOperation) : null,
      ageDays: row.status !== "REGLE" && date ? daysBetween(date.date, today) : null,
    };
  });
  const reminders = await db.reminder.findMany({ where: { partenaire: query.key }, orderBy: { sentAt: "desc" }, take: 20 });
  return ok({
    stats: statsOf(query.key, rows, query.annee, today),
    branches: branchStats,
    invoices,
    reminders: reminders.map((reminder) => {
      const payload = (reminder.payload && typeof reminder.payload === "object" && !Array.isArray(reminder.payload) ? reminder.payload : {}) as Record<string, unknown>;
      const by = payload.par && typeof payload.par === "object" ? String((payload.par as Record<string, unknown>).nom ?? "") : "";
      return { id: reminder.id, date: reminder.sentAt.toISOString(), succursale: String(payload.succursale ?? ""), nb: reminder.nb, montant: decimalToNumber(reminder.montant), by };
    }),
    canEdit: can(actor, "PART", "EDIT"),
  });
}

/** Factures à relancer : en attente depuis plus de `seuil` jours (ou sans date de facture). */
export async function overdueInvoices(actor: AuthUser, query: PartnerQuery): Promise<ActionResult<{ invoices: PartnerInvoice[]; total: number }>> {
  const detail = await partnerDetail(actor, { ...query, annee: "all" });
  if (!detail.success) return detail;
  const list = detail.data.invoices
    .filter((invoice) => invoice.status === "EN_ATTENTE" || invoice.status === "PARTIEL")
    .filter((invoice) => invoice.ageDays === null || invoice.ageDays > query.seuil)
    .sort((a, b) => (a.factureDate ?? "0").localeCompare(b.factureDate ?? "0"));
  return ok({ invoices: list, total: round2(list.reduce((sum, invoice) => sum + invoice.remaining, 0)) });
}

/** Enregistre une relance (avant impression de la lettre). */
export async function recordReminder(actor: AuthUser, query: PartnerQuery): Promise<ActionResult<{ count: number; total: number }>> {
  const guard = requireAccess(actor, "PART", "EDIT");
  if (!guard.success) return guard;
  const overdue = await overdueInvoices(actor, query);
  if (!overdue.success) return overdue;
  if (!overdue.data.invoices.length) return fail(`Aucune facture en retard de plus de ${query.seuil} jours pour ${query.key}.`, "NOT_FOUND");
  const now = new Date();
  await db.reminder.create({
    data: {
      legacyId: `rel-${crypto.randomUUID()}`,
      partenaire: query.key,
      montant: overdue.data.total,
      nb: overdue.data.invoices.length,
      sentAt: now,
      payload: { succursale: query.succ, seuil: query.seuil, factures: overdue.data.invoices.map((invoice) => invoice.id), par: { nom: actor.name, par: actor.id, le: now.toISOString() } },
    },
  });
  await logAction(actor, "Relance partenaire", `${query.key}${query.succ ? ` – ${query.succ}` : ""} : ${overdue.data.invoices.length} facture(s), ${formatDA(overdue.data.total)}`);
  return ok({ count: overdue.data.invoices.length, total: overdue.data.total });
}

/** Relevé de compte Excel d'un partenaire (synthèse par succursale + factures). */
export async function partnerStatement(actor: AuthUser, query: PartnerQuery): Promise<ActionResult<{ name: string; bytes: Uint8Array }>> {
  const detail = await partnerDetail(actor, { ...query, annee: "all" });
  if (!detail.success) return detail;
  const summary: Array<Array<string | number | null>> = [["Succursale", "Facturé", "Encaissé", "Solde dû", "Factures en attente", "Délai médian (j)"]];
  for (const branch of detail.data.branches) summary.push([branch.name, branch.invoiced, branch.collected, branch.balance, branch.pending, branch.medianDelay]);
  const invoices: Array<Array<string | number | null>> = [["Succursale", "N° facture", "Libellé", "Date facture", "Date estimée", "Montant TTC", "Reste dû", "État", "Date de règlement", "Mode", "N° chèque / réf.", "Délai (j)", "Ancienneté (j)"]];
  for (const invoice of detail.data.invoices) {
    invoices.push([
      invoice.succursale,
      invoice.numero,
      invoice.libelle,
      invoice.factureDate,
      invoice.estimated ? "oui" : "",
      invoice.montant,
      invoice.remaining,
      invoice.status === "REGLE" ? "Réglé" : invoice.status === "PARTIEL" ? "Partiel" : "En attente",
      invoice.dateOperation,
      invoice.mode === "CHEQUE" ? "Chèque" : invoice.mode === "VIREMENT" ? "Virement" : invoice.mode,
      invoice.cheque,
      invoice.delayDays,
      invoice.ageDays,
    ]);
  }
  const name = `Releve_compte_${query.key.replace(/\W+/g, "_")}${query.succ ? `_${query.succ.replace(/\W+/g, "_")}` : ""}_${todayIso()}.xlsx`;
  await logAction(actor, "Export Excel", name);
  return ok({
    name,
    bytes: writeWorkbook([
      { name: "Synthèse", rows: summary, widths: [24, 16, 16, 16, 12, 12] },
      { name: "Factures", rows: invoices, widths: [18, 18, 46, 12, 8, 14, 14, 10, 12, 10, 16, 8, 10] },
    ]),
  });
}
