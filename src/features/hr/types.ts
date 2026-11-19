/** Natures de saisie RH (reprises de l'ancienne version). */
export const HR_NATURES = ["Salaire", "Avance sur salaire", "Prime", "CNAS", "CASNOS", "G50", "IRG", "IBS", "Frais de mission", "Remboursement employé", "Autre charge de personnel"] as const;

/** Regroupement des natures pour la synthèse. */
export type HrGroup = "sal" | "cnas" | "g50" | "autre";

/** Libellés des groupes. */
export const HR_GROUP_LABELS: Readonly<Record<HrGroup, string>> = { sal: "Salaires", cnas: "CNAS / CASNOS", g50: "G50 / IRG", autre: "Avances, primes, autres" };

/** Groupe d'une nature. */
export function hrGroup(nature: string): HrGroup {
  return /^Salaire/.test(nature) ? "sal" : /CNAS|CASNOS/.test(nature) ? "cnas" : /G50|IRG|IBS/.test(nature) ? "g50" : "autre";
}

/** Statut d'une écriture face au relevé bancaire : rapprochée, probable, non trouvée, ou sans objet (retour, autre mode). */
export type HrBankStatus = "rapproche" | "probable" | "non_trouve" | "na";

/** Rapprochement d'une écriture RH avec le relevé (lecture seule). */
export interface HrBankInfo {
  status: HrBankStatus;
  /** Date et libellé de la ligne du relevé (vides si le profil n'a pas accès au relevé). */
  date: string | null;
  libelle: string;
  /** « montant seul » pour un rapprochement faible. */
  detail: string;
}

/** Anomalie affichée dans l'encadré de la page RH. */
export interface HrAnomalyDTO {
  kind: "doublon" | "beneficiaire" | "periode";
  level: "certain" | "probable" | null;
  message: string;
}

/** Saisie RH. */
export interface HrEntryDTO {
  id: string;
  date: string | null;
  mois: string;
  annee: number;
  monthKey: string;
  nature: string;
  beneficiaire: string;
  libelle: string;
  montant: number;
  sens: "PAIEMENT" | "RETOUR";
  mode: string;
  cheque: string;
  banque: string;
  par: string;
  releve: HrBankInfo;
}

/** Totaux par groupe. */
export type HrTotals = Record<HrGroup, number>;
