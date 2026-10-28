/** Produits d'une demande de paiement (cases du modèle papier). */
export const DP_PRODUCTS = ["Assistance routière", "BDG", "Tiers payant", "Autre"] as const;
export type DpProduct = (typeof DP_PRODUCTS)[number];

/** Modes de règlement d'une demande (codes de l'ancienne version). */
export const DP_MODES = ["VIRMT", "CHEQUE"] as const;
export type DpMode = (typeof DP_MODES)[number];

/** Statuts : à valider (créée automatiquement), émise (validée / importée). */
export const DP_STATUSES = ["a_valider", "emise"] as const;
export type DpStatus = (typeof DP_STATUSES)[number];

/** État de paiement déduit des factures reliées. */
export type DpPaymentState = "payee" | "partielle" | "non_payee" | "non_reliee";

/** Demande de paiement telle qu'affichée. */
export interface PaymentRequestDTO {
  id: string;
  num: number;
  ref: string;
  date: string | null;
  beneficiaire: string;
  adresse: string;
  montant: number;
  nature: string;
  mode: string;
  produit: string;
  status: string;
  source: string;
  pieces: string[];
  archived: boolean;
  invoiceIds: string[];
  payment: { state: DpPaymentState; label: string; invoices: Array<{ id: string; label: string; status: string }> };
  transferSent: string | null;
  createdBy: string;
}

/** Facture fournisseur proposée pour une demande. */
export interface DpInvoiceOption {
  id: string;
  label: string;
  tiers: string;
  montant: number;
  dateFacture: string | null;
  linkedRef: string | null;
}

/** Demande lue dans un fichier Excel de demandes de paiement. */
export interface ImportedRequest {
  num: number;
  ref: string;
  beneficiaire: string;
  adresse: string;
  montant: number;
  nature: string;
  mode: string;
  produit: string;
  produitDeduit: boolean;
  pieces: string[];
  factures: Array<{ n: string; d: string }>;
}

/** Plan d'import (avant application). */
export interface DpImportPlan {
  sheets: number;
  add: ImportedRequest[];
  update: Array<{ id: string; ref: string; request: ImportedRequest }>;
  unchanged: number;
  deduced: number;
  unknownProduct: number;
}
