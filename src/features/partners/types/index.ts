/** Indicateurs d'un partenaire. */
export interface PartnerStats {
  key: string;
  invoiced: number;
  collected: number;
  balance: number;
  pending: number;
  medianDelay: number | null;
  oldestDays: number;
  noDate: number;
}

/** Tranches de la prévision des encaissements. */
export const FORECAST_BUCKETS = [
  ["retard", "En retard"],
  ["s30", "Sous 30 j"],
  ["s60", "31 à 60 j"],
  ["s90", "61 à 90 j"],
  ["plus", "Au-delà"],
  ["inc", "Date de facture inconnue"],
] as const;
export type ForecastBucket = (typeof FORECAST_BUCKETS)[number][0];

/** Prévision par partenaire. */
export interface PartnerForecast {
  totals: Record<ForecastBucket, number>;
  byPartner: Record<string, Record<ForecastBucket, number>>;
}

/** Facture d'un partenaire (fiche). */
export interface PartnerInvoice {
  id: string;
  numero: string;
  succursale: string;
  libelle: string;
  factureDate: string | null;
  estimated: boolean;
  montant: number;
  remaining: number;
  status: string;
  dateOperation: string | null;
  mode: string;
  cheque: string;
  delayDays: number | null;
  ageDays: number | null;
}

/** Ligne « succursale » de la fiche partenaire. */
export interface BranchStats {
  name: string;
  invoiced: number;
  collected: number;
  balance: number;
  pending: number;
  medianDelay: number | null;
}

/** Fiche partenaire. */
export interface PartnerDetail {
  stats: PartnerStats;
  branches: BranchStats[];
  invoices: PartnerInvoice[];
  reminders: Array<{ id: string; date: string; succursale: string; nb: number; montant: number; by: string }>;
}
