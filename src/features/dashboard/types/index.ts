/** Montant agrégé pour un libellé (catégorie, tiers, tranche d'âge…). */
export interface AmountBucket {
  label: string;
  amount: number;
  count: number;
}

/** Encaissements et décaissements d'un mois (`AAAA-MM`). */
export interface MonthlyFlow {
  month: string;
  encaisse: number;
  decaisse: number;
}

/** Données du tableau de bord. */
export interface DashboardData {
  asOf: string;
  showCredit: boolean;
  showDebit: boolean;
  receivables: { total: number; count: number; byCategory: AmountBucket[] };
  payables: { total: number; count: number; byTiers: AmountBucket[] };
  currentMonth: { month: string; encaisse: number; decaisse: number };
  aging: AmountBucket[];
  monthly: MonthlyFlow[];
}
