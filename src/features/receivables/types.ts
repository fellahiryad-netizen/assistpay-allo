import type { AgingKey } from "@/features/receivables/lib/aging";
import type { ReceivableActivity } from "@/features/receivables/lib/company";

/** Facture partenaire en attente, telle que lue en base (montants en DA, dates `AAAA-MM-JJ`). */
export interface ReceivableInput {
  id: string;
  categorie: string;
  numero: string;
  libelle: string;
  montant: number;
  dateFacture: string | null;
  dateOperation: string | null;
}

/** Facture en attente enrichie : compagnie, activité et ancienneté. */
export interface ReceivableLine extends ReceivableInput {
  company: string;
  activity: ReceivableActivity;
  /** Jours depuis la date de facture (à défaut d'opération) ; `null` sans date. */
  ageDays: number | null;
  aging: AgingKey;
}

/** Montant et nombre de factures. */
export interface AmountCount {
  amount: number;
  count: number;
}

/** Ligne du tableau : une compagnie. */
export interface CompanyRow {
  company: string;
  slug: string;
  amount: number;
  /** Part du total en % (une décimale ; la somme des lignes fait 100,0). */
  share: number;
  count: number;
  oldestDays: number | null;
  oldestDate: string | null;
  oldestNumero: string;
  byActivity: Record<ReceivableActivity, AmountCount>;
  aging: Record<AgingKey, AmountCount>;
  /** Catégories brutes présentes (ex. « CAAT », « BDG CAAT »). */
  categories: string[];
}

/** Point d'attention : compagnie, nombre de factures et montant. */
export interface AttentionItem {
  company: string;
  count: number;
  amount: number;
}

/** Résultat complet de l'analyse des créances. */
export interface ReceivablesSummary {
  asOf: string;
  total: number;
  count: number;
  companies: CompanyRow[];
  byActivity: Record<ReceivableActivity, AmountCount>;
  aging: Record<AgingKey, AmountCount>;
  /** Ancienneté moyenne pondérée par les montants (jours), sur les factures datées ; `null` si aucune. */
  weightedAgeDays: number | null;
  undated: AmountCount;
  mostExposed: { company: string; share: number; amount: number } | null;
  attention: { over90: AttentionItem[]; undated: AttentionItem[] };
}

/** Filtre d'activité de la page : `null` = toutes. */
export type ActivityFilter = ReceivableActivity | null;
