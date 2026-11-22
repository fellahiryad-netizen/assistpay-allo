import type { TreasuryComputation } from "@/features/treasury/lib/compute";
import type { IssuedCheque } from "@/features/treasury/lib/circulation";
import type { HrDateAnomaly, LedgerGap } from "@/features/treasury/lib/controls";
import type { FreshnessLevel } from "@/features/treasury/lib/balance-state";
import type { Suggestion } from "@/features/treasury/lib/duplicates";
import type { RequestInput } from "@/features/treasury/lib/payables";
import type { BalanceRejection, DailyBalance, SimLine, SimType, TreasurySettings } from "@/features/treasury/types";

/** Solde affiché et sa fraîcheur. */
export interface BalanceView {
  source: "releve" | "manuel";
  balance: number;
  date: string;
  lastOperationDate: string | null;
  /** Texte de la source : « relevé AGB importé », ou la source saisie à la main. */
  sourceLabel: string;
  fileName: string;
  /** Horodatage ISO de l'import ou de la saisie. */
  savedAt: string;
  savedBy: string;
  freshness: FreshnessLevel;
  workingDays: number;
}

/** Scénario résumé pour la liste. */
export interface ScenarioSummary {
  id: string;
  nom: string;
  creeLe: string;
  creePar: string;
  lines: number;
}

/** Ligne de simulation et ses doublons éventuels. */
export interface SimLineView extends SimLine {
  /** Doublons repérés dans le RH ou le relevé (vide si aucun). */
  warnings: string[];
}

/** Scénario actif avec ses lignes. */
export interface ActiveScenarioView {
  id: string;
  nom: string;
  creeLe: string;
  creePar: string;
  lignes: SimLineView[];
}

/** Lignes simulées signalées comme doublon possible et comptées tant qu'elles ne sont pas écartées. */
export interface DuplicatesView {
  count: number;
  /** Montant de ces lignes, compris dans le total à payer. */
  total: number;
  /** Solde après paiements si ces lignes étaient écartées. */
  balanceAfterWithout: number;
  lines: Array<{ id: string; type: SimType; libelle: string; montant: number; date: string; messages: string[] }>;
}

/** Bloc « Contrôles ». */
export interface ControlsView {
  /** Écart relevé / journal du CRM ; null si le relevé n'a pas de solde de départ ou si le solde est saisi à la main. */
  ledger: (LedgerGap & { crmLines: number }) | null;
  unmatched: { debitCount: number; debitTotal: number; creditCount: number; creditTotal: number };
  /** Mouvements du CRM postérieurs à la date du solde (ajoutés au solde disponible, non confirmés par le relevé). */
  posterior: { count: number; total: number };
  hrAnomalies: HrDateAnomaly[];
  hrAnomaliesTotal: number;
  chequesToVerify: IssuedCheque[];
  /** Factures en attente portant un numéro de chèque (déjà comptées dans le reste à payer, jamais en circulation). */
  pendingWithCheque: number;
  /** Trous de plus de 7 jours dans le relevé. */
  gaps: string[];
  checks: { formula: boolean; lastLine: boolean; chain: boolean } | null;
}

/** Tout ce que l'écran, l'impression et l'export affichent. */
export interface TreasuryView {
  today: string;
  /** Horodatage ISO du calcul. */
  generatedAt: string;
  permissions: { simulate: boolean; settings: boolean; /** Peut importer un relevé (droit de modifier le module Relevé bancaire). */ importStatement: boolean };
  settings: TreasurySettings;
  balance: BalanceView | null;
  rejection: BalanceRejection | null;
  /** Solde saisi à la main : existe-t-il, et la saisie est-elle permise (aucun relevé valide ou dernier relevé refusé) ? */
  manual: { has: boolean; allowed: boolean };
  /** Null tant qu'aucun solde n'est disponible. */
  computation: TreasuryComputation | null;
  /** Soldes de fin de journée du relevé (historique du graphique). */
  history: DailyBalance[];
  scenarios: ScenarioSummary[];
  active: ActiveScenarioView | null;
  /** Lignes simulées signalées comme doublon possible et encore comptées ; null s'il n'y en a pas. */
  duplicates: DuplicatesView | null;
  suggestions: Record<SimType, Suggestion>;
  cheques: IssuedCheque[];
  controls: ControlsView;
  includeRequests: boolean;
  requestsWithoutInvoice: RequestInput[];
}
