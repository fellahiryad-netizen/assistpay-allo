import { round2 } from "@/utils/amounts";
import {
  CUSHION_CHOICES,
  MAX_LINES_PER_SCENARIO,
  MAX_SCENARIOS,
  SIM_CERTAINTIES,
  SIM_MODES,
  SIM_TYPES,
  type CushionDays,
  type DailyBalance,
  type ManualBalance,
  type MonthlyFlow,
  type Scenario,
  type ScenariosState,
  type SimLine,
  type SoldeState,
  type StoredBalance,
  type TreasurySettings,
} from "@/features/treasury/types";

type Json = Record<string, unknown>;

const isRecord = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): string => (typeof value === "string" ? value : "");
const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
const isIso = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

/** Réglages par défaut : réserve de 15 jours, aucun encaissement compté. */
export const DEFAULT_SETTINGS: TreasurySettings = { coussinJours: 15, encaissementsAttendus: false };

/** Lecture tolérante de la clé `tresorerie:reglages`. */
export function parseSettings(value: unknown): TreasurySettings {
  if (!isRecord(value)) return DEFAULT_SETTINGS;
  const days = CUSHION_CHOICES.find((choice) => choice === value.coussinJours);
  return { coussinJours: (days ?? 15) as CushionDays, encaissementsAttendus: value.encaissementsAttendus === true };
}

function parseDaily(value: unknown): DailyBalance[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): DailyBalance[] => (isRecord(item) && isIso(item.d) && num(item.b) !== null ? [{ d: item.d, b: num(item.b) ?? 0 }] : []));
}

function parseMonthly(value: unknown): MonthlyFlow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): MonthlyFlow[] => (isRecord(item) && /^\d{4}-\d{2}$/.test(str(item.m)) && num(item.credit) !== null && num(item.debit) !== null ? [{ m: str(item.m), credit: num(item.credit) ?? 0, debit: num(item.debit) ?? 0 }] : []));
}

function parseStored(value: unknown): StoredBalance | null {
  if (!isRecord(value) || !isIso(value.balanceDate) || num(value.balance) === null) return null;
  const checks = isRecord(value.checks) ? value.checks : {};
  return {
    accountNumber: str(value.accountNumber),
    balanceDate: value.balanceDate,
    balance: num(value.balance) ?? 0,
    sens: value.sens === "DB" ? "DB" : "CT",
    editedOn: isIso(value.editedOn) ? value.editedOn : null,
    opening: num(value.opening) ?? 0,
    openingDate: isIso(value.openingDate) ? value.openingDate : null,
    sumCredits: num(value.sumCredits) ?? 0,
    sumDebits: num(value.sumDebits) ?? 0,
    rowCount: num(value.rowCount) ?? 0,
    lastOperationDate: isIso(value.lastOperationDate) ? value.lastOperationDate : null,
    checks: { formula: checks.formula === true, lastLine: checks.lastLine === true, chain: checks.chain === true },
    daily: parseDaily(value.daily),
    monthly: parseMonthly(value.monthly),
    gaps: Array.isArray(value.gaps) ? value.gaps.filter((gap): gap is string => typeof gap === "string") : [],
    fileName: str(value.fileName),
    importedAt: str(value.importedAt),
    importedBy: str(value.importedBy),
  };
}

function parseManual(value: unknown): ManualBalance | null {
  if (!isRecord(value) || !isIso(value.date) || num(value.balance) === null) return null;
  return { balance: num(value.balance) ?? 0, date: value.date, source: str(value.source), savedAt: str(value.savedAt), savedBy: str(value.savedBy) };
}

/** Lecture tolérante de la clé `tresorerie:solde`. Un solde enregistré dont un contrôle n'est pas passé est écarté. */
export function parseSolde(value: unknown): SoldeState {
  if (!isRecord(value)) return { current: null, manual: null, rejection: null };
  const current = parseStored(value.current);
  const rejection = isRecord(value.rejection) ? value.rejection : null;
  const reason = str(rejection?.reason);
  return {
    current: current && current.checks.formula && current.checks.lastLine && current.checks.chain ? current : null,
    manual: parseManual(value.manual),
    rejection: rejection
      ? { at: str(rejection.at), fileName: str(rejection.fileName), reason: reason === "structure" || reason === "compte" || reason === "incoherent" || reason === "ancien" ? reason : "incoherent", message: str(rejection.message) }
      : null,
  };
}

function parseLine(value: unknown): SimLine | null {
  if (!isRecord(value)) return null;
  const type = SIM_TYPES.find((item) => item === value.type);
  const mode = SIM_MODES.find((item) => item === value.mode);
  const certitude = SIM_CERTAINTIES.find((item) => item === value.certitude);
  const montant = num(value.montant);
  if (!str(value.id) || !type || !mode || !certitude || montant === null || montant <= 0 || !isIso(value.date)) return null;
  return {
    id: str(value.id),
    type,
    libelle: str(value.libelle).slice(0, 120),
    periode: /^\d{4}-(0[1-9]|1[0-2])$/.test(str(value.periode)) ? str(value.periode) : "",
    montant: round2(montant),
    date: value.date,
    mode,
    certitude,
    decision: value.decision === "ignorer" || value.decision === "garder" ? value.decision : null,
  };
}

/**
 * Lecture tolérante de la clé `tresorerie:scenarios` : les entrées illisibles sont écartées, les plafonds (20 scénarios, 50 lignes par scénario)
 * sont appliqués et le scénario actif est remis à null s'il n'existe plus.
 */
export function parseScenarios(value: unknown): ScenariosState {
  if (!isRecord(value) || !Array.isArray(value.scenarios)) return { actif: null, scenarios: [] };
  const seen = new Set<string>();
  const scenarios: Scenario[] = [];
  for (const item of value.scenarios) {
    if (!isRecord(item) || !str(item.id) || seen.has(str(item.id)) || scenarios.length >= MAX_SCENARIOS) continue;
    seen.add(str(item.id));
    const lines = Array.isArray(item.lignes) ? item.lignes.map(parseLine).filter((line): line is SimLine => line !== null) : [];
    scenarios.push({ id: str(item.id), nom: str(item.nom).slice(0, 80) || "Scénario", creeLe: str(item.creeLe), creePar: str(item.creePar), lignes: lines.slice(0, MAX_LINES_PER_SCENARIO) });
  }
  const actif = typeof value.actif === "string" && scenarios.some((scenario) => scenario.id === value.actif) ? value.actif : null;
  return { actif, scenarios };
}
