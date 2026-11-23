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

/** Périmètre d'un panneau de détail : une compagnie, éventuellement limitée à une activité (« CAAT:BDG »). */
export interface DetailScope {
  company: string;
  /** `null` = toutes les activités de la compagnie. */
  activity: ReceivableActivity | null;
}

/** Facture en attente telle que lue pour le détail (en plus des champs de `ReceivableInput`). */
export interface DetailInput extends ReceivableInput {
  tiers: string;
  succursale: string;
  periode: string;
  /** Partenaire au sens de la fiche partenaire (`partnerKey`), utile pour la relance. */
  partner: string;
}

/** Facture du détail : compagnie, activité, ancienneté, succursale. */
export interface DetailLine extends ReceivableLine {
  tiers: string;
  periode: string;
  partner: string;
  /** Nom lisible de la succursale, « Non précisée » si elle ne peut pas être déterminée. */
  branch: string;
  /** Clé de succursale de la fiche partenaire (`branchOf`) ; vide si inconnue. */
  branchKey: string;
}

/** Facture dans le panneau de détail. */
export interface DetailInvoice {
  id: string;
  numero: string;
  libelle: string;
  periode: string;
  date: string | null;
  ageDays: number | null;
  aging: AgingKey;
  amount: number;
  partner: string;
  /** Dernière relance connue (`AAAA-MM-JJ`), `null` si aucune ou si le droit Partenaires manque. */
  lastReminder: string | null;
}

/** Succursale dans le panneau de détail. */
export interface DetailBranch {
  label: string;
  branchKey: string;
  amount: number;
  count: number;
  /** Part en % du total du panneau (somme 100,0). */
  share: number;
  oldestDays: number | null;
  oldestDate: string | null;
  lastReminder: string | null;
  /** Partenaires (clés de fiche) présents dans cette succursale, pour les liens de relance. */
  partners: string[];
  invoices: DetailInvoice[];
}

/** Relance enregistrée (module Partenaires), réduite à ce dont le détail a besoin. */
export interface ReminderRef {
  partenaire: string;
  sentAt: string;
  succursale: string;
  factures: string[];
}

/** Panneau de détail d'une compagnie ou d'une compagnie × activité. */
export interface ReceivableDetail {
  scope: DetailScope;
  /** Montant de toutes les factures du périmètre (égal au montant de la ligne cliquée du tableau). */
  scopeTotal: number;
  scopeCount: number;
  /** Seuil d'ancienneté appliqué (jours), `null` = aucun. */
  minAge: number | null;
  /** Montant affiché dans le panneau (égal à `scopeTotal` sans filtre d'ancienneté). */
  total: number;
  count: number;
  branches: DetailBranch[];
}
