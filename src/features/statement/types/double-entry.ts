/** Prestataire d'un envoi de virements et la ou les factures retrouvées au Débit. */
export interface TransferBeneficiaryMatch {
  nom: string;
  montant: number;
  count: number;
  invoices: Array<{ id: string; label: string; montant: number }>;
  /** Factures du même prestataire mais d'un autre montant. */
  otherCandidates: number;
}

/** Débit global du relevé reconnu comme un envoi de virements, à détailler prestataire par prestataire. */
export interface TransferReconciliation {
  lineId: string;
  date: string;
  libelle: string;
  montant: number;
  batch: { id: string; ref: string; produit: string; mois: string; annee: number | null; nb: number };
  beneficiaries: TransferBeneficiaryMatch[];
  /** Lignes déjà saisies au Débit pour ce même montant (paiement global déjà enregistré). */
  existing: Array<{ id: string; label: string; montant: number; date: string | null }>;
}

/** Ligne du Débit utilisée dans le contrôle de double emploi. */
export interface DoubleEntryRow {
  id: string;
  date: string | null;
  label: string;
  montant: number;
  montantGlobal: number | null;
}

/** Cas de double emploi détecté au Débit. */
export type DoubleEntryCase =
  | { kind: "pair"; a: DoubleEntryRow; b: DoubleEntryRow }
  | { kind: "global"; global: DoubleEntryRow; candidates: DoubleEntryRow[]; preselected: string[]; exact: boolean; transferRef: string | null };
