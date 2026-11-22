import { round2 } from "@/utils/amounts";
import type { ChequeReport } from "@/features/treasury/lib/circulation";
import { buildTimeline, buildVerdict, coverageDays, cushionAmount, spendingReference, type SpendingReference, type Timeline, type Verdict } from "@/features/treasury/lib/risk";
import type { ExpectedCollections } from "@/features/treasury/lib/receivables";
import {
  invoiceItems,
  priorityGroups,
  priorityOrder,
  requestItems,
  simulationItems,
  sumAmounts,
  totalsByNature,
  type PayableItem,
  type PendingInvoiceInput,
  type PriorityGroup,
  type RequestInput,
} from "@/features/treasury/lib/payables";
import type { DailyBalance, MonthlyFlow, ResolvedBalance, SimLine, TreasurySettings } from "@/features/treasury/types";

/** Lot de virements préparé et non exécuté (information, jamais additionné aux factures). */
export interface PreparedBatch {
  ref: string;
  montant: number;
}

/** Données d'entrée du calcul de trésorerie (déjà lues et réduites par le service). */
export interface ComputeInput {
  today: string;
  balance: ResolvedBalance;
  monthly: readonly MonthlyFlow[];
  daily: readonly DailyBalance[];
  /** Mouvements du CRM postérieurs à la date du solde, non confirmés par le relevé (crédits − débits). */
  adjustment: number;
  cheques: ChequeReport;
  invoices: readonly PendingInvoiceInput[];
  preparedBatches: readonly PreparedBatch[];
  requestsWithoutInvoice: readonly RequestInput[];
  includeRequests: boolean;
  simulationLines: readonly SimLine[];
  settings: TreasurySettings;
  collections: ExpectedCollections;
}

/** Ligne de l'échéancier avec le solde disponible après ce paiement. */
export interface ScheduleRow extends PayableItem {
  balanceAfter: number;
}

/** Résultat du calcul de trésorerie. */
export interface TreasuryComputation {
  bank: number;
  chequesTotal: number;
  adjustment: number;
  /** Solde disponible estimé : banque + mouvements non confirmés − chèques en circulation. */
  available: number;
  /** Reste à payer : somme des restes des factures fournisseurs en attente. */
  invoicesTotal: number;
  /** Paiements simulés comptés. */
  simulationTotal: number;
  /** Demandes sans facture liée, comptées seulement si la case est cochée. */
  requestsTotal: number;
  totalToPay: number;
  balanceAfter: number;
  /** Disponible ÷ total à payer ; null si rien à payer. */
  coverageRatio: number | null;
  coverageDays: number | null;
  reference: SpendingReference | null;
  cushion: number;
  cushionDays: number;
  timeline: Timeline;
  verdict: Verdict;
  schedule: ScheduleRow[];
  byNature: ReturnType<typeof totalsByNature>;
  priority: PriorityGroup[];
  /** Part du reste à payer déjà dans des virements préparés (information). */
  preparedTotal: number;
  preparedCount: number;
  /** Demandes sans facture liée (information, hors total par défaut). */
  requestsInfo: { count: number; total: number };
  expected: ExpectedCollections;
  /** Solde après paiements en comptant les encaissements attendus (non garantis), ou null si l'option est désactivée. */
  balanceAfterExpected: number | null;
}

/**
 * Calcul complet de la trésorerie. Le reste à payer vient des seules factures ; les lots de virements et les demandes de paiement n'y sont jamais additionnés
 * (les demandes sans facture liée ne le sont que sur demande explicite). Les chèques en circulation sont retranchés du solde bancaire.
 * Les encaissements attendus n'entrent ni dans le solde après paiements ni dans le niveau de risque : ils n'alimentent que la série pointillée du graphique.
 */
export function computeTreasury(input: ComputeInput): TreasuryComputation {
  const start = input.balance.date;
  const bank = input.balance.balance;
  const available = round2(bank + input.adjustment - input.cheques.total);
  const invoices = invoiceItems(input.invoices, start, input.today);
  const requests = input.includeRequests ? requestItems(input.requestsWithoutInvoice, start) : [];
  const simulation = simulationItems(input.simulationLines, start);
  const payables = [...invoices, ...requests, ...simulation];
  const invoicesTotal = sumAmounts(invoices);
  const simulationTotal = sumAmounts(simulation);
  const requestsTotal = sumAmounts(requests);
  const totalToPay = round2(invoicesTotal + simulationTotal + requestsTotal);
  const balanceAfter = round2(available - totalToPay);

  const reference = spendingReference(input.monthly, start, input.daily[0]?.d ?? null);
  const cushion = cushionAmount(reference, input.settings.coussinJours);
  const useExpected = input.settings.encaissementsAttendus;
  const timeline = buildTimeline(start, available, payables.map((item) => ({ date: item.date, montant: item.montant })), useExpected ? input.collections.flows : null);
  const perDay = reference?.perDay ?? 0;
  const verdict = buildVerdict({ historyKnown: reference !== null, balanceAfter, cushion, lowest: timeline.lowest.balance, overdraftDate: timeline.overdraftDate, perDay, cushionDays: input.settings.coussinJours, lowestDate: timeline.lowest.date });

  let running = available;
  const schedule: ScheduleRow[] = priorityOrder(payables)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((item) => {
      running = round2(running - item.montant);
      return { ...item, balanceAfter: running };
    });

  return {
    bank,
    chequesTotal: input.cheques.total,
    adjustment: input.adjustment,
    available,
    invoicesTotal,
    simulationTotal,
    requestsTotal,
    totalToPay,
    balanceAfter,
    coverageRatio: totalToPay > 0 ? available / totalToPay : null,
    coverageDays: coverageDays(balanceAfter, perDay),
    reference,
    cushion,
    cushionDays: input.settings.coussinJours,
    timeline,
    verdict,
    schedule,
    byNature: totalsByNature(payables),
    priority: priorityGroups(payables),
    preparedTotal: sumAmounts(input.preparedBatches.map((batch) => ({ montant: batch.montant }))),
    preparedCount: input.preparedBatches.length,
    requestsInfo: { count: input.requestsWithoutInvoice.length, total: sumAmounts(input.requestsWithoutInvoice) },
    expected: input.collections,
    balanceAfterExpected: useExpected ? round2(balanceAfter + input.collections.total) : null,
  };
}
