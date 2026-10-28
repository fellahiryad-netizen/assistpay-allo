import type { SensKey } from "@/features/invoices/types";

/** Statuts d'une ligne de relevé (enum Prisma `StatementStatus`). */
export const STATEMENT_STATUS_KEYS = ["A_TRAITER", "RAPPROCHE", "DEJA", "IGNORE", "AJOUTE"] as const;
export type StatementStatusKey = (typeof STATEMENT_STATUS_KEYS)[number];

export const STATEMENT_STATUS_LABELS: Readonly<Record<StatementStatusKey, string>> = {
  A_TRAITER: "À traiter",
  RAPPROCHE: "Rapproché",
  DEJA: "Déjà enregistré",
  IGNORE: "Ignoré",
  AJOUTE: "Ajouté au suivi",
};

/** Mode de paiement détecté dans le libellé bancaire (codes de l'ancienne version). */
export type BankPaymentType = "CHEQUE" | "VIRMT" | "VRSMT" | "";

/** Ligne lue dans le fichier de la banque. */
export interface ParsedLine {
  /** Identifiant stable calculé sur la date, le sens, le montant et le libellé (même calcul que l'ancienne version). */
  key: string;
  date: string;
  libelle: string;
  montant: number;
  sens: SensKey;
  type: BankPaymentType;
  numero: string;
}

/** Correspondance des colonnes du fichier (index de colonne, -1 = absente). */
export interface ColumnMapping {
  date: number;
  libelle: number;
  ref: number;
  credit: number;
  debit: number;
  montant: number;
}

/** Aperçu d'un fichier avant analyse. */
export interface StatementPreview {
  fileName: string;
  headerRow: number;
  headers: string[];
  mapping: ColumnMapping;
  sample: string[][];
  rowCount: number;
}

/** Partie de facture proposée pour un paiement. */
export interface ProposalItem {
  invoiceId: string;
  legacyId: string;
  part: "tout" | "debours" | "frais";
  amount: number;
  label: string;
}

/** Niveau de confiance d'une proposition. */
export type Confidence = "sur" | "probable" | "verifier";

/** Paiement du relevé rapproché automatiquement de facture(s) en attente : à valider. */
export interface Proposal {
  line: ParsedLine;
  items: ProposalItem[];
  alternatives: ProposalItem[];
  confidence: Confidence;
  /** Fichier de virements reconnu pour ce débit, le cas échéant. */
  transferRef: string | null;
}

/** Paiement déjà présent dans le suivi (facture déjà réglée). */
export interface RecordedMatch {
  line: ParsedLine;
  labels: string[];
}

/** Résultat d'une analyse de relevé. */
export interface StatementAnalysis {
  total: number;
  proposals: Proposal[];
  recorded: RecordedMatch[];
  todo: ParsedLine[];
  alreadyImported: number;
  bankFees: { count: number; amount: number };
  payrollLines: number;
}

/** Ligne de relevé enregistrée. */
export interface StatementLineDTO {
  id: string;
  legacyId: string;
  date: string;
  libelle: string;
  montant: number;
  sens: SensKey;
  type: string;
  numero: string;
  status: StatementStatusKey;
  invoiceRefs: string[];
  importedAt: string;
  /** Doublon probable : même montant et libellé à moins de 20 jours. */
  twinDate: string | null;
  /** Envoi de virements reconnu (débit global). */
  transfer: { id: string; ref: string; produit: string; nb: number; mois: string } | null;
  /** Ligne paie (salaires, CNAS, impôts) probable. */
  payroll: boolean;
}

/** Facture proposée lors d'une affectation manuelle. */
export interface AssignCandidate {
  invoiceId: string;
  label: string;
  amount: number;
  part: "tout" | "debours" | "frais";
  exact: boolean;
}
