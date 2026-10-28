/** Point de la liste de clôture du mois. */
export interface ClosingItem {
  state: "ok" | "warn" | "err";
  title: string;
  detail: string;
  href?: string;
}

/** Tranches de la balance âgée. */
export const AGING_BUCKETS: ReadonlyArray<[string, number, number]> = [
  ["0-30 j", 0, 30],
  ["31-60 j", 31, 60],
  ["61-90 j", 61, 90],
  ["91-180 j", 91, 180],
  ["+180 j", 181, Number.POSITIVE_INFINITY],
];

/** Ligne de la balance âgée (un partenaire). */
export interface AgingRow {
  partner: string;
  count: number;
  buckets: number[];
  undated: number;
  total: number;
  dso: number | null;
}

/** Prévision de trésorerie sur 4 colonnes (immédiat, J+30, J+60, J+90). */
export interface TreasuryForecast {
  inflows: number[];
  providers: number[];
  payroll: number[];
  others: number[];
  outflows: number[];
  net: number[];
  cumulative: number[];
  averages: { providers: number; payroll: number; others: number; months: string[] };
}

/** Rentabilité d'une activité sur l'année (12 mois). */
export interface ActivityMargin {
  key: string;
  label: string;
  production: number[];
  cost: number[];
  totalProduction: number;
  totalCost: number;
}
