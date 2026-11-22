import { db } from "@/lib/db";
import type { AuthUser } from "@/features/access/types";
import { remaining, toPayable } from "@/features/invoices/services/invoice-balance";
import { logAction } from "@/features/journal/services/journal-service";
import { freshness, resolveBalance } from "@/features/treasury/lib/balance-state";
import { chequesInCirculation, type BankDebit, type IssuedCheque } from "@/features/treasury/lib/circulation";
import { computeTreasury } from "@/features/treasury/lib/compute";
import { hrDateAnomalies, ledgerGap } from "@/features/treasury/lib/controls";
import { findDuplicates, suggestFor, type HrLite } from "@/features/treasury/lib/duplicates";
import type { PendingInvoiceInput, RequestInput } from "@/features/treasury/lib/payables";
import { delayStats, expectedCollections, type PendingReceivable, type SettledInput } from "@/features/treasury/lib/receivables";
import { activeScenario } from "@/features/treasury/lib/scenario-state";
import { parseScenarios, parseSettings, parseSolde } from "@/features/treasury/lib/store-parse";
import type { ManualBalanceInput, TreasuryQuery, TreasurySettingsInput } from "@/features/treasury/schemas";
import { requireTreasury } from "@/features/treasury/services/treasury-access";
import { KEY_SCENARIOS, KEY_SETTINGS, KEY_SOLDE, readState, updateState } from "@/features/treasury/services/treasury-store";
import { SIM_TYPES } from "@/features/treasury/types";
import type { ActiveScenarioView, BalanceView, ControlsView, ScenarioSummary, TreasuryView } from "@/features/treasury/types/view";
import { monthKeyOfEntry } from "@/features/hr/lib/hr-period";
import { fail, ok, type ActionResult } from "@/types";
import { round2 } from "@/utils/amounts";
import { shiftIsoDate, toIsoDate, todayIso } from "@/utils/dates";
import { formatDA, formatDate } from "@/utils/format";

/** Décimal SQL → nombre au centime (valeur absente : 0). */
function dec(value: { toNumber(): number } | null | undefined): number {
  return value ? Math.round(value.toNumber() * 100) / 100 : 0;
}

/** Écritures RH et débits du relevé utiles à l'anti-doublon et aux suggestions (lecture seule). */
export async function loadDuplicateSources(): Promise<{ hr: HrLite[]; debits: BankDebit[] }> {
  const [hrRows, lines] = await Promise.all([
    db.hrEntry.findMany({ where: { sens: "PAIEMENT" }, select: { id: true, nature: true, mois: true, annee: true, date: true, montant: true, libelle: true, beneficiaire: true } }),
    db.bankStatementLine.findMany({ where: { sens: "DEBIT" }, select: { date: true, libelle: true, numero: true, montant: true } }),
  ]);
  return {
    hr: hrRows.map((row) => {
      const date = toIsoDate(row.date);
      return { id: row.id, nature: row.nature, monthKey: monthKeyOfEntry({ nature: row.nature, mois: row.mois, annee: row.annee, date }), date, montant: dec(row.montant), libelle: row.libelle, beneficiaire: row.beneficiaire };
    }),
    debits: lines.map((line) => ({ date: toIsoDate(line.date) ?? "", libelle: line.libelle, numero: line.numero, montant: dec(line.montant) })),
  };
}

/**
 * Données de l'onglet Trésorerie : solde du dernier relevé importé, chèques en circulation, reste à payer des factures fournisseurs,
 * simulation active, contrôles. Lecture seule. Accès Administrateur, Direction ou Comptable (contrôlé ici, pas seulement par le menu).
 * Une consultation avec un scénario actif est écrite au journal d'administration.
 */
export async function getTreasuryView(actor: AuthUser, query: TreasuryQuery): Promise<ActionResult<TreasuryView>> {
  const guard = requireTreasury(actor, "view");
  if (!guard.success) return guard;
  try {
    const today = todayIso();
    const [solde, scenarioState, settings] = await Promise.all([readState(KEY_SOLDE, parseSolde), readState(KEY_SCENARIOS, parseScenarios), readState(KEY_SETTINGS, parseSettings)]);
    const resolved = resolveBalance(solde);
    const active = activeScenario(scenarioState);
    const sources = await loadDuplicateSources();
    const suggestions = Object.fromEntries(SIM_TYPES.map((type) => [type, suggestFor(type, sources.hr)])) as TreasuryView["suggestions"];
    const scenarios: ScenarioSummary[] = scenarioState.scenarios.map((scenario) => ({ id: scenario.id, nom: scenario.nom, creeLe: scenario.creeLe, creePar: scenario.creePar, lines: scenario.lignes.length }));
    const base = {
      today,
      generatedAt: new Date().toISOString(),
      permissions: { simulate: true, settings: requireTreasury(actor, "settings").success },
      settings,
      rejection: solde.rejection,
      manual: { has: solde.manual !== null, allowed: solde.current === null || solde.rejection !== null },
      history: [],
      scenarios,
      suggestions,
      includeRequests: query.demandes,
    };
    const emptyControls: ControlsView = { ledger: null, unmatched: { debitCount: 0, debitTotal: 0, creditCount: 0, creditTotal: 0 }, posterior: { count: 0, total: 0 }, hrAnomalies: [], hrAnomaliesTotal: 0, chequesToVerify: [], pendingWithCheque: 0, gaps: [], checks: null };
    if (!resolved) {
      return ok({ ...base, balance: null, computation: null, active: null, cheques: [], controls: emptyControls, requestsWithoutInvoice: [] });
    }

    const balanceDate = resolved.date;
    const openingDate = solde.current?.openingDate ?? null;
    const yearStart = `${today.slice(0, 4)}-01-01`;
    const dateOf = (iso: string): Date => new Date(`${iso}T00:00:00Z`);
    const [pendingRows, receivableRows, settledRows, batches, requests, hrRows, coverage, crmSums, unmatchedSums, posteriorSums] = await Promise.all([
      db.invoice.findMany({ where: { sens: "DEBIT", status: "EN_ATTENTE", payroll: false, archived: false } }),
      db.invoice.findMany({ where: { sens: "CREDIT", status: "EN_ATTENTE", payroll: false, archived: false } }),
      db.invoice.findMany({ where: { sens: "CREDIT", status: "REGLE", archived: false, dateOperation: { gte: dateOf(yearStart) } }, select: { categorie: true, libelle: true, tiers: true, dateFacture: true, dateOperation: true } }),
      db.transferBatch.findMany({ where: { status: "attente" }, select: { ref: true, debit: true } }),
      db.paymentRequest.findMany({ where: { archived: false, invoiceIds: { isEmpty: true }, status: { in: ["emise", "a_valider"] } }, select: { id: true, ref: true, beneficiaire: true, montant: true } }),
      db.hrEntry.findMany({ select: { id: true, nature: true, date: true, montant: true, libelle: true, beneficiaire: true, mode: true, cheque: true, sens: true } }),
      db.bankStatementLine.aggregate({ _min: { date: true } }),
      openingDate ? db.bankStatementLine.groupBy({ by: ["sens"], where: { date: { gte: dateOf(openingDate), lte: dateOf(balanceDate) } }, _sum: { montant: true }, _count: { _all: true } }) : Promise.resolve([]),
      db.bankStatementLine.groupBy({ by: ["sens"], where: { status: "A_TRAITER" }, _sum: { montant: true }, _count: { _all: true } }),
      db.bankStatementLine.groupBy({ by: ["sens"], where: { date: { gt: dateOf(balanceDate) } }, _sum: { montant: true }, _count: { _all: true } }),
    ]);
    const coverageStart = toIsoDate(coverage._min.date);
    const chequeInvoices = coverageStart
      ? await db.invoice.findMany({ where: { sens: "DEBIT", mode: "CHEQUE", cheque: { not: "" }, status: "REGLE", payroll: false, archived: false, dateOperation: { gte: dateOf(shiftIsoDate(coverageStart, -10)) } } })
      : [];

    const issued: IssuedCheque[] = [
      ...hrRows
        .filter((row) => row.sens === "PAIEMENT" && row.mode.toUpperCase() === "CHEQUE" && row.cheque.trim() !== "")
        .map((row): IssuedCheque => ({ source: "rh", id: row.id, numero: row.cheque.trim(), montant: dec(row.montant), date: toIsoDate(row.date), beneficiaire: row.beneficiaire, libelle: row.libelle })),
      ...chequeInvoices.map((row): IssuedCheque => ({ source: "facture", id: row.id, numero: row.cheque.trim(), montant: dec(row.montant), date: toIsoDate(row.dateOperation), beneficiaire: row.tiers, libelle: row.libelle })),
    ];
    const cheques = chequesInCirculation(issued, sources.debits, today, coverageStart);

    const pendingInvoices: PendingInvoiceInput[] = pendingRows.map((row) => {
      const payable = toPayable(row);
      return { id: row.id, numero: row.numero, tiers: row.tiers, categorie: row.categorie, libelle: row.libelle, dateFacture: toIsoDate(row.dateFacture), remaining: remaining(payable) };
    });
    const receivables: PendingReceivable[] = receivableRows.map((row) => ({ id: row.id, numero: row.numero, categorie: row.categorie, libelle: row.libelle, tiers: row.tiers, dateFacture: toIsoDate(row.dateFacture), remaining: remaining(toPayable(row)) }));
    const settled: SettledInput[] = settledRows.map((row) => ({ categorie: row.categorie, libelle: row.libelle, tiers: row.tiers, dateFacture: toIsoDate(row.dateFacture), dateOperation: toIsoDate(row.dateOperation) }));
    const collections = expectedCollections(receivables, delayStats(settled), today, settings.encaissementsAttendus);
    const requestList: RequestInput[] = requests.map((row) => ({ id: row.id, ref: row.ref, beneficiaire: row.beneficiaire, montant: dec(row.montant) }));

    const sum = (rows: Array<{ sens: string; _sum: { montant: { toNumber(): number } | null }; _count: { _all: number } }>, sens: "CREDIT" | "DEBIT"): { total: number; count: number } => {
      const row = rows.find((item) => item.sens === sens);
      return { total: dec(row?._sum.montant), count: row?._count._all ?? 0 };
    };
    const posteriorCredit = sum(posteriorSums, "CREDIT");
    const posteriorDebit = sum(posteriorSums, "DEBIT");
    const adjustment = round2(posteriorCredit.total - posteriorDebit.total);
    const simulationLines = active?.lignes ?? [];

    const computation = computeTreasury({
      today,
      balance: resolved,
      monthly: solde.current?.monthly ?? [],
      daily: solde.current?.daily ?? [],
      adjustment,
      cheques,
      invoices: pendingInvoices,
      preparedBatches: batches.map((batch) => ({ ref: batch.ref, montant: dec(batch.debit) })),
      requestsWithoutInvoice: requestList,
      includeRequests: query.demandes,
      simulationLines,
      settings,
      collections,
    });

    const activeView: ActiveScenarioView | null = active
      ? {
          id: active.id,
          nom: active.nom,
          creeLe: active.creeLe,
          creePar: active.creePar,
          lignes: active.lignes.map((line) => ({
            ...line,
            warnings: line.decision === null ? findDuplicates(line, sources.hr, sources.debits, balanceDate).map((hit) => hit.message) : [],
          })),
        }
      : null;

    const crmCredit = sum(crmSums, "CREDIT");
    const crmDebit = sum(crmSums, "DEBIT");
    const unmatchedCredit = sum(unmatchedSums, "CREDIT");
    const unmatchedDebit = sum(unmatchedSums, "DEBIT");
    const anomalies = hrDateAnomalies(hrRows.map((row) => ({ id: row.id, nature: row.nature, libelle: row.libelle || row.beneficiaire, montant: dec(row.montant), date: toIsoDate(row.date) })), today);
    const controls: ControlsView = {
      ledger: solde.current && resolved.source === "releve" && crmCredit.count + crmDebit.count > 0 ? { ...ledgerGap(solde.current.balance, solde.current.opening, crmCredit.total, crmDebit.total), crmLines: crmCredit.count + crmDebit.count } : null,
      unmatched: { debitCount: unmatchedDebit.count, debitTotal: unmatchedDebit.total, creditCount: unmatchedCredit.count, creditTotal: unmatchedCredit.total },
      posterior: { count: posteriorCredit.count + posteriorDebit.count, total: adjustment },
      hrAnomalies: anomalies.slice(0, 12),
      hrAnomaliesTotal: anomalies.length,
      chequesToVerify: cheques.toVerify,
      pendingWithCheque: pendingRows.filter((row) => row.cheque.trim() !== "").length,
      gaps: solde.current?.gaps ?? [],
      checks: solde.current?.checks ?? null,
    };

    const fresh = freshness(resolved.date, today);
    const balance: BalanceView = {
      source: resolved.source,
      balance: resolved.balance,
      date: resolved.date,
      lastOperationDate: resolved.lastOperationDate,
      sourceLabel: resolved.sourceLabel,
      fileName: resolved.fileName,
      savedAt: resolved.savedAt,
      savedBy: resolved.savedBy,
      freshness: fresh.level,
      workingDays: fresh.workingDays,
    };
    if (active) await logAction(actor, "Consultation d'un scénario de trésorerie", `${active.nom} (${active.lignes.length} lignes)`, true);
    return ok({
      ...base,
      balance,
      computation,
      history: (solde.current?.daily ?? []).filter((point) => point.d >= shiftIsoDate(balanceDate, -120)),
      active: activeView,
      cheques: cheques.circulation,
      controls,
      requestsWithoutInvoice: requestList,
    });
  } catch (error) {
    console.error("[tresorerie] lecture :", error);
    return fail("La trésorerie n'a pas pu être calculée.", "DATABASE");
  }
}

/** Réglages : réserve conseillée (7, 15 ou 30 jours) et encaissements attendus. Administrateur ou Direction. */
export async function saveTreasurySettings(actor: AuthUser, input: TreasurySettingsInput): Promise<ActionResult<true>> {
  const guard = requireTreasury(actor, "settings");
  if (!guard.success) return guard;
  try {
    const saved = await updateState(KEY_SETTINGS, parseSettings, () => ({ ok: true, state: { coussinJours: input.coussinJours, encaissementsAttendus: input.encaissementsAttendus } }));
    if (!saved.success) return saved;
    await logAction(actor, "Réglages de la trésorerie", `Réserve ${input.coussinJours} jours ; encaissements attendus : ${input.encaissementsAttendus ? "comptés (non garantis)" : "non comptés"}`, true);
    return ok(true);
  } catch (error) {
    console.error("[tresorerie] réglages :", error);
    return fail("Les réglages n'ont pas pu être enregistrés.", "DATABASE");
  }
}

/**
 * Solde saisi à la main (secours), Administrateur ou Direction. Refusé si un relevé valide est déjà enregistré sans refus récent,
 * si la date est future ou antérieure au solde du relevé. Il disparaît dès qu'un relevé valide au moins aussi récent est importé.
 */
export async function saveManualBalance(actor: AuthUser, input: ManualBalanceInput): Promise<ActionResult<true>> {
  const guard = requireTreasury(actor, "settings");
  if (!guard.success) return guard;
  try {
    const today = todayIso();
    if (input.date > today) return fail("La date du solde ne peut pas être dans le futur.", "VALIDATION");
    const saved = await updateState(KEY_SOLDE, parseSolde, (state) => {
      if (state.current && !state.rejection) return { ok: false, error: "Un relevé valide est déjà enregistré : le solde est repris du relevé, pas d'une saisie.", code: "CONFLICT" };
      if (state.current && input.date <= state.current.balanceDate) return { ok: false, error: `Le solde saisi doit être plus récent que celui du relevé importé (${formatDate(state.current.balanceDate)}).`, code: "VALIDATION" };
      return { ok: true, state: { ...state, manual: { balance: round2(input.balance), date: input.date, source: input.source, savedAt: new Date().toISOString(), savedBy: actor.name } } };
    });
    if (!saved.success) return saved;
    await logAction(actor, "Solde de trésorerie saisi à la main", `${formatDA(input.balance)} au ${formatDate(input.date)} (${input.source})`, true);
    return ok(true);
  } catch (error) {
    console.error("[tresorerie] solde manuel :", error);
    return fail("Le solde n'a pas pu être enregistré.", "DATABASE");
  }
}

/** Retire le solde saisi à la main (retour au solde du relevé). Administrateur ou Direction. */
export async function clearManualBalance(actor: AuthUser): Promise<ActionResult<true>> {
  const guard = requireTreasury(actor, "settings");
  if (!guard.success) return guard;
  try {
    const saved = await updateState(KEY_SOLDE, parseSolde, (state) => ({ ok: true, state: { ...state, manual: null } }));
    if (!saved.success) return saved;
    await logAction(actor, "Solde saisi à la main retiré", "Retour au solde du relevé importé", true);
    return ok(true);
  } catch (error) {
    console.error("[tresorerie] solde manuel :", error);
    return fail("Le solde saisi à la main n'a pas pu être retiré.", "DATABASE");
  }
}
