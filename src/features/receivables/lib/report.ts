import { AGING_BUCKETS, type AgingKey } from "@/features/receivables/lib/aging";
import type { DetailInvoice, ReceivableDetail } from "@/features/receivables/types";
import { formatDA, formatDate } from "@/utils/format";

/** Facture du rapport, avec sa succursale. */
export interface ReportInvoice extends DetailInvoice {
  branch: string;
}

/** Succursale du rapport. */
export interface ReportBranch {
  label: string;
  count: number;
  amount: number;
  /** Part en % du total (une décimale, la somme fait 100,0). */
  share: number;
  oldestDays: number | null;
  oldestDate: string | null;
  /** Date de la dernière relance de la succursale, `null` si aucune. */
  lastReminder: string | null;
  /** Montant des factures de plus de 90 jours. */
  over90: number;
  over90Count: number;
  invoices: ReportInvoice[];
}

/** Tranche d'ancienneté du rapport. */
export interface ReportAging {
  key: AgingKey;
  label: string;
  amount: number;
  count: number;
  share: number;
}

/** Données du rapport « factures impayées » pour la direction d'une compagnie. */
export interface ImpayesReport {
  company: string;
  asOf: string;
  total: number;
  count: number;
  /** Ancienneté moyenne pondérée par les montants (jours), `null` si aucune facture datée. */
  weightedAgeDays: number | null;
  over90: { amount: number; count: number; share: number };
  undated: { amount: number; count: number };
  aging: ReportAging[];
  branches: ReportBranch[];
  /** Les factures les plus anciennes (dix au plus), de la plus ancienne à la plus récente. */
  oldest: ReportInvoice[];
  /** Phrase de synthèse pour la première page. */
  headline: string;
}

const round2 = (value: number): number => Math.round(value * 100) / 100;
const round1 = (value: number): number => Math.round(value * 10) / 10;

/** Pourcentages à une décimale dont la somme fait exactement 100,0 (méthode du plus grand reste). */
function shares(amounts: readonly number[]): number[] {
  const total = amounts.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return amounts.map(() => 0);
  const raw = amounts.map((value) => (value / total) * 1000);
  const floors = raw.map(Math.floor);
  let left = 1000 - floors.reduce((sum, value) => sum + value, 0);
  const order = raw.map((value, index) => ({ index, rest: value - Math.floor(value) })).sort((a, b) => b.rest - a.rest);
  for (const item of order) {
    if (left <= 0) break;
    floors[item.index] = (floors[item.index] ?? 0) + 1;
    left -= 1;
  }
  return floors.map((value) => value / 10);
}

/** Texte de montant en millions de DA (« 281,9 M DA »). */
export function millions(value: number): string {
  return `${(Math.round(value / 100_000) / 10).toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} M DA`;
}

/**
 * Construit le rapport à partir du détail d'une compagnie (toutes activités, sans filtre d'ancienneté).
 * Aucun calcul de facture : seuls les montants et dates déjà présents sont additionnés et classés.
 */
export function buildImpayesReport(detail: ReceivableDetail, asOf: string): ImpayesReport {
  const company = detail.scope.company;
  const branches: ReportBranch[] = detail.branches
    .map((branch) => {
      const invoices: ReportInvoice[] = branch.invoices.map((invoice) => ({ ...invoice, branch: branch.label }));
      const old = invoices.filter((invoice) => invoice.aging === "D90_PLUS");
      return {
        label: branch.label,
        count: branch.count,
        amount: round2(branch.amount),
        share: 0,
        oldestDays: branch.oldestDays,
        oldestDate: branch.oldestDate,
        lastReminder: branch.lastReminder,
        over90: round2(old.reduce((sum, invoice) => sum + invoice.amount, 0)),
        over90Count: old.length,
        invoices,
      };
    })
    .sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label, "fr"));
  const branchShares = shares(branches.map((branch) => branch.amount));
  branches.forEach((branch, index) => {
    branch.share = branchShares[index] ?? 0;
  });
  const all = branches.flatMap((branch) => branch.invoices);
  const total = round2(all.reduce((sum, invoice) => sum + invoice.amount, 0));
  const agingAmounts = AGING_BUCKETS.map((bucket) => round2(all.filter((invoice) => invoice.aging === bucket.key).reduce((sum, invoice) => sum + invoice.amount, 0)));
  const agingShares = shares(agingAmounts);
  const aging: ReportAging[] = AGING_BUCKETS.map((bucket, index) => ({
    key: bucket.key,
    label: bucket.label,
    amount: agingAmounts[index] ?? 0,
    count: all.filter((invoice) => invoice.aging === bucket.key).length,
    share: agingShares[index] ?? 0,
  }));
  const dated = all.filter((invoice) => invoice.ageDays !== null);
  const datedTotal = dated.reduce((sum, invoice) => sum + invoice.amount, 0);
  const weightedAgeDays = datedTotal > 0 ? Math.round(dated.reduce((sum, invoice) => sum + invoice.amount * (invoice.ageDays ?? 0), 0) / datedTotal) : null;
  const over90Amount = aging.find((item) => item.key === "D90_PLUS");
  const undated = aging.find((item) => item.key === "SANS_DATE");
  const oldest = [...dated].sort((a, b) => (b.ageDays ?? 0) - (a.ageDays ?? 0) || b.amount - a.amount).slice(0, 10);
  const over90Share = total > 0 ? round1(((over90Amount?.amount ?? 0) / total) * 100) : 0;
  const top = branches[0];
  const headline =
    all.length === 0
      ? `Au ${formatDate(asOf)}, aucune facture ${company} n'est en attente de paiement.`
      : `Au ${formatDate(asOf)}, ${all.length} facture(s) ${company} restent à payer pour ${millions(total)}.` +
        (over90Share > 0 ? ` ${over90Share.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} % de ce montant a plus de 90 jours.` : "") +
        (top && branches.length > 1 ? ` ${top.label} concentre ${top.share.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} % du total.` : "");
  return {
    company,
    asOf,
    total,
    count: all.length,
    weightedAgeDays,
    over90: { amount: over90Amount?.amount ?? 0, count: over90Amount?.count ?? 0, share: over90Share },
    undated: { amount: undated?.amount ?? 0, count: undated?.count ?? 0 },
    aging,
    branches,
    oldest,
    headline,
  };
}

/** Phrase d'une succursale pour le bandeau « à retenir » des pages de détail. */
export function branchHeadline(branch: ReportBranch): string {
  const base = `${branch.label} : ${branch.count} facture(s) pour ${formatDA(branch.amount)}.`;
  return branch.over90 > 0 ? `${base} Dont ${formatDA(branch.over90)} de plus de 90 jours (${branch.over90Count} facture(s)).` : base;
}
