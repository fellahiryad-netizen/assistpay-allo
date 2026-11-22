import { round2 } from "@/utils/amounts";
import { daysBetween, shiftIsoDate } from "@/utils/dates";
import { upperPlain } from "@/utils/text";
import type { Flow } from "@/features/treasury/lib/risk";

/** Compagnies suivies pour les encaissements attendus. */
export type Company = "CAAT" | "CAAR" | "GAM" | "TRUST" | "MLA" | "AUTRES";

/** Ordre d'affichage. */
export const COMPANIES: readonly Company[] = ["CAAT", "CAAR", "GAM", "TRUST", "MLA", "AUTRES"];

/** Décote appliquée aux encaissements attendus. */
export const COLLECTION_DISCOUNT = 0.2;

/** Nombre minimal de factures réglées pour estimer un délai. */
export const MIN_SAMPLE = 3;

/** En dessous de ce nombre de factures réglées, l'échantillon est signalé comme faible. */
export const WEAK_SAMPLE = 10;

const PATTERNS: ReadonlyArray<[Exclude<Company, "AUTRES">, RegExp]> = [
  ["CAAT", /\bCAAT\b/],
  ["CAAR", /\bCAAR\b/],
  ["GAM", /\bGAM\b/],
  ["TRUST", /\bTRUST\b/],
  ["MLA", /\bMLA\b|MAGHREB LEASING/],
];

/**
 * Compagnie d'une créance, lue dans la catégorie, puis le libellé, puis le tiers (le tiers est souvent « ALLO Assistance »).
 * GAM + GAM BDG + Honoraire GAM, CAAT + BDG CAAT, TRUST + Trust BDG sont regroupés.
 */
export function companyOf(invoice: { categorie: string; libelle: string; tiers: string }): Company {
  for (const field of [invoice.categorie, invoice.libelle, invoice.tiers]) {
    const text = upperPlain(field);
    for (const [company, pattern] of PATTERNS) if (pattern.test(text)) return company;
  }
  return "AUTRES";
}

/** Délai de règlement observé d'une compagnie. */
export interface DelayStats {
  company: Company;
  sample: number;
  medianDays: number | null;
  /** 80 % des factures sont réglées en moins de ce nombre de jours. */
  p80Days: number | null;
}

/** Médiane (moyenne des deux valeurs centrales si le nombre est pair) ; null si vide. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[middle] ?? null) : (((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2);
}

/** Percentile par rang le plus proche ; null si vide. */
export function percentile(values: readonly number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1))] ?? null;
}

/** Facture partenaire réglée, pour mesurer les délais. */
export interface SettledInput {
  categorie: string;
  libelle: string;
  tiers: string;
  dateFacture: string | null;
  dateOperation: string | null;
}

/** Délais observés par compagnie (dateOperation − dateFacture, jours, facture datée et réglée après son émission). */
export function delayStats(settled: readonly SettledInput[]): DelayStats[] {
  return COMPANIES.map((company) => {
    const delays = settled
      .filter((invoice) => invoice.dateFacture && invoice.dateOperation && companyOf(invoice) === company)
      .map((invoice) => daysBetween(invoice.dateFacture ?? "", invoice.dateOperation ?? ""))
      .filter((delay) => delay >= 0);
    return { company, sample: delays.length, medianDays: median(delays), p80Days: percentile(delays, 0.8) };
  });
}

/** Créance partenaire en attente. */
export interface PendingReceivable {
  id: string;
  numero: string;
  categorie: string;
  libelle: string;
  tiers: string;
  dateFacture: string | null;
  /** Reste à encaisser. */
  remaining: number;
}

/** Ligne du tableau des encaissements attendus. */
export interface CollectionRow {
  company: Company;
  count: number;
  total: number;
  medianDays: number | null;
  p80Days: number | null;
  sample: number;
  weakSample: boolean;
  /** Montant retenu après décote (0 si l'option est désactivée). */
  counted: number;
  countedCount: number;
}

/** Encaissements attendus. */
export interface ExpectedCollections {
  rows: CollectionRow[];
  /** Mouvements datés retenus (déjà décotés) ; vides si l'option est désactivée. */
  flows: Flow[];
  total: number;
}

/**
 * Encaissements attendus (non garantis). Date attendue = date de facture + délai médian de la compagnie ; montant × (1 − 20 %).
 * Rien n'est compté pour une facture sans date, déjà en retard (date attendue passée), plus âgée que le délai du 80e percentile,
 * ou d'une compagnie dont l'échantillon est inférieur à 3 factures. Avec `enabled` faux, rien n'est compté (scénario prudent).
 */
export function expectedCollections(pending: readonly PendingReceivable[], stats: readonly DelayStats[], today: string, enabled: boolean): ExpectedCollections {
  const flows: Flow[] = [];
  const rows = COMPANIES.map((company): CollectionRow => {
    const stat = stats.find((item) => item.company === company) ?? { company, sample: 0, medianDays: null, p80Days: null };
    const list = pending.filter((invoice) => companyOf(invoice) === company && invoice.remaining > 0);
    let counted = 0;
    let countedCount = 0;
    if (enabled && stat.medianDays !== null && stat.p80Days !== null && stat.sample >= MIN_SAMPLE) {
      for (const invoice of list) {
        if (!invoice.dateFacture) continue;
        const age = daysBetween(invoice.dateFacture, today);
        const expectedDate = shiftIsoDate(invoice.dateFacture, Math.round(stat.medianDays));
        if (expectedDate < today || age > stat.p80Days) continue;
        const amount = round2(invoice.remaining * (1 - COLLECTION_DISCOUNT));
        flows.push({ date: expectedDate, montant: amount });
        counted = round2(counted + amount);
        countedCount += 1;
      }
    }
    return { company, count: list.length, total: round2(list.reduce((sum, invoice) => sum + invoice.remaining, 0)), medianDays: stat.medianDays, p80Days: stat.p80Days, sample: stat.sample, weakSample: stat.sample < WEAK_SAMPLE, counted, countedCount };
  }).filter((row) => row.count > 0);
  return { rows, flows, total: round2(flows.reduce((sum, flow) => sum + flow.montant, 0)) };
}
