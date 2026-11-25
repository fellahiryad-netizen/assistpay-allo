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

/** Anomalie affichée dans l'encadré de la page RH, (les écritures concernées sont dans un dictionnaire à part). */
export interface HrAnomalyDTO {
  key: string;
  kind: "doublon" | "beneficiaire" | "periode";
  level: "certain" | "probable" | null;
  message: string;
  /** Identifiants des écritures concernées (voir le dictionnaire `anomalyEntries` de la liste). */
  entryIds: string[];
}

/** Anomalie validée (« vérifiée, c'est normal »), rétablissable. */
export interface HrValidatedAnomalyDTO {
  key: string;
  kind: "doublon" | "beneficiaire" | "periode";
  message: string;
  motif: string;
  par: string;
  /** Horodatage ISO. */
  le: string;
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

/** Ligne du relevé liée à une écriture RH ou proposée pour l'affecter. */
export interface HrLineDTO {
  id: string;
  date: string;
  libelle: string;
  numero: string;
  montant: number;
  sens: "DEBIT" | "CREDIT";
  type: string;
  status: string;
  /** Écart avec le montant de l'écriture (propositions seulement). */
  ecart: number | null;
  exact: boolean;
}

/** Écriture voisine (même montant) montrée dans le détail pour repérer un doublon. */
export interface HrSimilarDTO {
  id: string;
  date: string | null;
  nature: string;
  beneficiaire: string;
  libelle: string;
  montant: number;
}

/** Détail complet d'une écriture RH : champs, relevé lié, propositions d'affectation, écritures voisines, historique. */
export interface HrDetailDTO {
  entry: HrEntryDTO;
  /** Lignes du relevé déjà liées à l'écriture. */
  linked: HrLineDTO[];
  /** Lignes libres du relevé qui pourraient correspondre. */
  candidates: HrLineDTO[];
  similar: HrSimilarDTO[];
  creePar: string;
  creeLe: string;
  majPar: string;
  majLe: string;
  /** Le profil voit-il le relevé ? (sinon `linked` et `candidates` sont vides.) */
  releveVisible: boolean;
  /** Peut-il affecter / détacher (RH et relevé en modification) ? */
  canAssign: boolean;
  canEdit: boolean;
}
