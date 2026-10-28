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
  periode: string;
  debours: number | null;
  frais: number | null;
  origine: string;
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
  /** Peut-on modifier les factures de chaque sens ? */
  canEdit: Record<SensKey, boolean>;
}

/** Valeurs proposées dans les filtres. */
export interface InvoiceFilterOptions {
  years: number[];
  categories: string[];
  sens: SensKey[];
}
