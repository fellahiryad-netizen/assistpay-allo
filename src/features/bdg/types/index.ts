/** Facture BDG avec sa répartition débours / frais de gestion. */
export interface BdgInvoiceDTO {
  id: string;
  numero: string;
  categorie: string;
  tiers: string;
  succursale: string;
  periode: string;
  libelle: string;
  status: "EN_ATTENTE" | "REGLE" | "ANNULE";
  montant: number;
  split: boolean;
  debours: number;
  frais: number;
  factureDebours: string;
  factureFrais: string;
  regDebours: string | null;
  regFrais: string | null;
  remaining: number;
  partial: boolean;
}

/** Indicateurs BDG. */
export interface BdgSummary {
  deboursDue: number;
  fraisDue: number;
  unsplitAmount: number;
  unsplitCount: number;
  partialCount: number;
}
