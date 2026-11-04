/** Sens comptable : crédit = facture client (encaissement), débit = facture fournisseur (décaissement). */
export const SENS_KEYS = ["CREDIT", "DEBIT"] as const;
export type SensKey = (typeof SENS_KEYS)[number];

export const INVOICE_STATUS_KEYS = ["EN_ATTENTE", "REGLE", "ANNULE"] as const;
export type InvoiceStatusKey = (typeof INVOICE_STATUS_KEYS)[number];

export const PAYMENT_MODE_KEYS = ["VIREMENT", "CHEQUE", "VERSEMENT", "AUTRE"] as const;
export type PaymentModeKey = (typeof PAYMENT_MODE_KEYS)[number];

export const SENS_LABELS: Readonly<Record<SensKey, string>> = { CREDIT: "Crédit", DEBIT: "Débit" };
export const STATUS_LABELS: Readonly<Record<InvoiceStatusKey, string>> = {
  EN_ATTENTE: "En attente",
  REGLE: "Réglé",
  ANNULE: "Annulé",
};
export const MODE_LABELS: Readonly<Record<PaymentModeKey, string>> = {
  VIREMENT: "Virement",
  CHEQUE: "Chèque",
  VERSEMENT: "Versement",
  AUTRE: "Autre",
};

/** Facture telle qu'exposée à l'interface (montants en nombre, dates `AAAA-MM-JJ`). */
export interface InvoiceDTO {
  id: string;
  legacyId: string;
  sens: SensKey;
  status: InvoiceStatusKey;
  categorie: string;
  tiers: string;
  numero: string;
  libelle: string;
  montant: number;
  montantGlobal: number | null;
  dateOperation: string | null;
  dateFacture: string | null;
  annee: number | null;
  mode: PaymentModeKey | null;
  cheque: string;
  banque: string;
  nature: string;
  classe: number | null;
  succursale: string;
  /** Nom lisible de la succursale (déduit du libellé ou du tiers si le champ est vide). */
  succursaleNom: string;
  periode: string;
  debours: number | null;
  frais: number | null;
  origine: string;
  /** Dernière personne ayant saisi ou modifié la facture. */
  par: string;
  /** Règlement partiel en cours (acomptes reçus, facture encore en attente). */
  partiel: boolean;
  archived: boolean;
  payroll: boolean;
  updatedAt: string;
}

/** Résultat d'une recherche de factures. */
export interface InvoiceListResult {
  items: InvoiceDTO[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  sumMontant: number;
  /** Factures émises (module Facturation) liées aux lignes de la page : id de la ligne → id de la facture imprimable. */
  printable: Record<string, string>;
  /** Peut-on modifier les factures de chaque sens ? */
  canEdit: Record<SensKey, boolean>;
}

/** Valeurs proposées dans les filtres. */
export interface InvoiceFilterOptions {
  years: number[];
  categories: string[];
  /** Succursales CAAT / CAAR présentes dans les factures visibles. */
  branches: string[];
  sens: SensKey[];
}
