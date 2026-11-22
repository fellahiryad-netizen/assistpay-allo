/** Numéro du compte AGB d'EURL ALLO ASSISTANCE : seul compte accepté pour le solde de la trésorerie. */
export const AGB_ACCOUNT = "2737851208";

/** Tolérance (en DA) des contrôles d'égalité de montants. */
export const BALANCE_TOLERANCE = 0.01;

/** Solde de fin d'une journée (solde après la dernière opération de la journée). */
export interface DailyBalance {
  /** Date `AAAA-MM-JJ`. */
  d: string;
  /** Solde en DA, deux décimales. */
  b: number;
}

/** Flux d'un mois civil du relevé. */
export interface MonthlyFlow {
  /** Mois `AAAA-MM`. */
  m: string;
  /** Total des crédits du mois (positif). */
  credit: number;
  /** Total des débits du mois (positif, sens « sortie d'argent »). */
  debit: number;
}

/** Résultat des trois contrôles d'un relevé. */
export interface BalanceChecks {
  /** Départ + crédits − débits = « Solde FIN AU ». */
  formula: boolean;
  /** Le solde de la dernière opération (première ligne du fichier) = « Solde FIN AU ». */
  lastLine: boolean;
  /** Chaîne ligne à ligne : chaque solde = solde précédent + opération. */
  chain: boolean;
}

/** Données lues dans un relevé AGB dont les contrôles sont passés. */
export interface StatementBalance {
  accountNumber: string;
  /** Date de « Solde FIN AU » (`AAAA-MM-JJ`) : date du solde. */
  balanceDate: string;
  /** Solde de fin, en DA (négatif si le sens est « DB »). */
  balance: number;
  /** Sens lu dans le fichier : « CT » créditeur, « DB » débiteur. */
  sens: "CT" | "DB";
  /** Date d'édition du relevé (`AAAA-MM-JJ`) ou null. */
  editedOn: string | null;
  opening: number;
  openingDate: string | null;
  sumCredits: number;
  /** Somme des débits, négative comme dans le fichier. */
  sumDebits: number;
  rowCount: number;
  /** Date de la dernière opération, ou null si le relevé n'a aucune opération. */
  lastOperationDate: string | null;
  checks: BalanceChecks;
  daily: DailyBalance[];
  monthly: MonthlyFlow[];
  /** Trous de plus de 7 jours entre deux opérations (à titre d'information). */
  gaps: string[];
}

/** Motif d'un relevé non utilisable pour le solde. */
export type BalanceRefusalKind = "structure" | "compte" | "incoherent";

/** Résultat de la lecture du solde d'un relevé. */
export type StatementBalanceResult =
  | { kind: "ok"; balance: StatementBalance }
  | { kind: "refused"; reason: BalanceRefusalKind; message: string; checks: BalanceChecks | null };

/** Solde enregistré à l'import. */
export interface StoredBalance extends StatementBalance {
  fileName: string;
  /** Horodatage ISO de l'import. */
  importedAt: string;
  importedBy: string;
}

/** Solde saisi à la main par un administrateur (secours). */
export interface ManualBalance {
  balance: number;
  /** Date du solde `AAAA-MM-JJ`. */
  date: string;
  /** Source indiquée (« relevé AGB du … »). */
  source: string;
  savedAt: string;
  savedBy: string;
}

/** Dernier fichier refusé pour le solde. */
export interface BalanceRejection {
  at: string;
  fileName: string;
  reason: BalanceRefusalKind | "ancien";
  message: string;
}

/** Contenu de la clé `tresorerie:solde`. */
export interface SoldeState {
  current: StoredBalance | null;
  manual: ManualBalance | null;
  rejection: BalanceRejection | null;
}

/** Solde retenu pour l'écran. */
export interface ResolvedBalance {
  source: "releve" | "manuel";
  balance: number;
  /** Date du solde `AAAA-MM-JJ`. */
  date: string;
  lastOperationDate: string | null;
  fileName: string;
  /** Horodatage ISO de l'import ou de la saisie. */
  savedAt: string;
  savedBy: string;
  /** Texte de la source pour l'affichage. */
  sourceLabel: string;
}

/** Types de lignes de simulation. */
export const SIM_TYPES = ["CNAS", "G50", "IRG_IBS", "SALAIRES", "AUTRE"] as const;
export type SimType = (typeof SIM_TYPES)[number];

/** Libellés des types de lignes de simulation. */
export const SIM_TYPE_LABELS: Readonly<Record<SimType, string>> = {
  CNAS: "CNAS",
  G50: "G50",
  IRG_IBS: "IRG / IBS",
  SALAIRES: "Salaires",
  AUTRE: "Autre",
};

/** Modes de paiement d'une ligne simulée. */
export const SIM_MODES = ["CHEQUE", "VIREMENT", "PRELEVEMENT"] as const;
export type SimMode = (typeof SIM_MODES)[number];

/** Libellés des modes de paiement. */
export const SIM_MODE_LABELS: Readonly<Record<SimMode, string>> = { CHEQUE: "Chèque", VIREMENT: "Virement", PRELEVEMENT: "Prélèvement" };

/** Certitude d'un montant simulé. */
export const SIM_CERTAINTIES = ["CERTAIN", "ESTIME"] as const;
export type SimCertainty = (typeof SIM_CERTAINTIES)[number];

/** Décision de la comptable sur un doublon signalé. */
export type DuplicateDecision = "ignorer" | "garder";

/** Ligne de simulation (paiement hypothétique saisi par la comptable). */
export interface SimLine {
  id: string;
  type: SimType;
  libelle: string;
  /** Période concernée `AAAA-MM`, ou chaîne vide. */
  periode: string;
  /** Montant en DA, strictement positif. */
  montant: number;
  /** Date prévue de décaissement `AAAA-MM-JJ`. */
  date: string;
  mode: SimMode;
  certitude: SimCertainty;
  /** null : doublon éventuel non tranché. */
  decision: DuplicateDecision | null;
}

/** Scénario nommé : un jeu de lignes de simulation. */
export interface Scenario {
  id: string;
  nom: string;
  /** Horodatage ISO de création. */
  creeLe: string;
  creePar: string;
  lignes: SimLine[];
}

/** Contenu de la clé `tresorerie:scenarios`. */
export interface ScenariosState {
  /**
   * Ancien champ de la première version, où le scénario actif était partagé entre tous les utilisateurs : conservé tel quel dans la donnée mais jamais lu.
   * Le scénario actif est désormais propre à chaque utilisateur (voir `ActiveState`).
   */
  actif: string | null;
  scenarios: Scenario[];
}

/** Nombre de jours de la réserve conseillée. */
export const CUSHION_CHOICES = [7, 15, 30] as const;
export type CushionDays = (typeof CUSHION_CHOICES)[number];

/** Contenu de la clé `tresorerie:reglages`. */
export interface TreasurySettings {
  coussinJours: CushionDays;
  encaissementsAttendus: boolean;
}

/** Plafonds de la simulation. */
export const MAX_SCENARIOS = 20;
export const MAX_LINES_PER_SCENARIO = 50;
/** Montant à partir duquel une ligne demande une confirmation explicite (DA). */
export const SIM_CONFIRM_AMOUNT = 100_000_000;

/** Contenu de la clé `tresorerie:actif:<identifiant de l'utilisateur>` : le scénario que cet utilisateur a activé (null : situation réelle). */
export interface ActiveState {
  scenarioId: string | null;
}
