import type { TransferProduct } from "@/features/transfers/services/rib";

/** Gravité d'un contrôle. */
export type Severity = "ok" | "info" | "warn" | "err";

/** Ligne d'un fichier de virements contrôlée. */
export interface CheckedLine {
  row: number;
  banque: string;
  agence: string;
  compte: string;
  cle: string;
  nom: string;
  prenom: string;
  adresse: string;
  montant: number;
  sens: string;
  ribOk: boolean;
  expectedKey: number | null;
  kind: "" | "nouveau" | "compte" | "rib" | "ancien" | "refuse" | "remplace" | "supprime" | "nom";
  issues: Array<{ severity: Severity; message: string }>;
  severity: Severity;
  otherAccounts: string[];
  overMonthly: boolean;
}

/** Contrôle global du fichier. */
export interface FileCheck {
  severity: Severity;
  title: string;
  detail: string;
}

/** Résultat du contrôle d'un fichier de virements. */
export interface TransferAnalysis {
  type: TransferProduct;
  lines: CheckedLine[];
  checks: FileCheck[];
  debit: number | null;
  credit: number;
  gap: number | null;
  credits: number;
  verdict: Severity;
  errors: number;
  warnings: number;
  newProviders: number;
  ribChanges: number;
  overMonthly: number;
}

/** Envoi de virements (historique). */
export interface TransferBatchDTO {
  id: string;
  ref: string;
  fichier: string;
  type: string;
  produit: string;
  annee: number | null;
  mois: string;
  debit: number;
  credit: number;
  nb: number;
  status: string;
  verdict: string;
  src: string;
  comment: string;
  updatedAt: string;
  /** Débit du relevé correspondant, s'il est déjà importé. */
  statement: { date: string; status: string } | null;
}

/** Compte du référentiel RIB. */
export interface ProviderRibDTO {
  id: string;
  key: string;
  rib: string;
  code: string;
  noms: string[];
  types: string[];
  wilaya: string;
  status: string;
  origine: string;
  isNew: boolean;
  proposed: { rib: string; envoi: string; by: string } | null;
  change: { type: string; others: string[] } | null;
  oldRibs: string[];
  history: { count: number; total: number; lastRef: string | null };
}

/** Demande de paiement proposée dans l'état des virements. */
export interface SheetRequest {
  id: string;
  ref: string;
  date: string | null;
  beneficiaire: string;
  pieces: string[];
  montant: number;
  product: TransferProduct;
  alreadySent: string | null;
  old: boolean;
  selected: boolean;
}

/** Ligne de virement calculée (un prestataire). */
export interface SheetLine {
  key: string;
  beneficiaire: string;
  requestIds: string[];
  requestRefs: string[];
  montant: number;
  parts: number[];
  rib: string;
  ribSource: "referentiel" | "saisi" | "fichier" | "";
  accountId: string | null;
  candidates: Array<{ id: string; rib: string; label: string }>;
  nom: string;
  prenom: string;
  adresse: string;
  bank: string;
  problem: "" | "rib" | "cle" | "adr" | "nom" | "choix";
  note: string;
}
