import { shiftIsoDate } from "@/utils/dates";
import type { BalanceRefusalKind, DailyBalance, MonthlyFlow, ManualBalance, ResolvedBalance, SoldeState, StatementBalance, StoredBalance } from "@/features/treasury/types";

/** État initial de la clé `tresorerie:solde`. */
export const EMPTY_SOLDE: SoldeState = { current: null, manual: null, rejection: null };

/** Décision prise à l'enregistrement d'un solde lu dans un relevé. */
export type ImportDecision =
  | { action: "stored"; state: SoldeState }
  | { action: "ignored"; state: SoldeState; reason: "ancien"; message: string };

const lastDayOfMonth = (iso: string): boolean => shiftIsoDate(iso, 1).slice(0, 7) !== iso.slice(0, 7);

/** Un mois est complet dans un relevé si le relevé commence au plus tard le 1er et s'arrête au plus tôt le dernier jour du mois. */
function monthComplete(m: string, start: string | null, end: string | null): boolean {
  if (!start || !end) return false;
  const startOk = start.slice(0, 7) < m || (start.slice(0, 7) === m && start.slice(8, 10) === "01");
  const endOk = end.slice(0, 7) > m || (end.slice(0, 7) === m && lastDayOfMonth(end));
  return startOk && endOk;
}

/**
 * Fusionne l'historique d'un nouveau relevé avec celui déjà enregistré, pour qu'un relevé plus court ne raccourcisse jamais l'historique :
 * soldes quotidiens réunis par date (le relevé le plus récent l'emporte), mois réunis en préférant la version complète (à égalité le nouveau relevé),
 * sinon la plus fournie en débits.
 */
export function mergeHistory(previous: StatementBalance | null, next: StatementBalance): { daily: DailyBalance[]; monthly: MonthlyFlow[] } {
  if (!previous) return { daily: next.daily, monthly: next.monthly };
  const daily = new Map<string, DailyBalance>();
  for (const point of previous.daily) daily.set(point.d, point);
  for (const point of next.daily) daily.set(point.d, point);
  const prevStart = previous.daily[0]?.d ?? null;
  const prevEnd = previous.lastOperationDate ?? previous.balanceDate;
  const nextStart = next.daily[0]?.d ?? null;
  const nextEnd = next.lastOperationDate ?? next.balanceDate;
  const months = new Map<string, MonthlyFlow>();
  for (const flow of previous.monthly) months.set(flow.m, flow);
  for (const flow of next.monthly) {
    const old = months.get(flow.m);
    if (!old) {
      months.set(flow.m, flow);
      continue;
    }
    const newComplete = monthComplete(flow.m, nextStart, nextEnd);
    const oldComplete = monthComplete(flow.m, prevStart, prevEnd);
    if (newComplete || (!oldComplete && flow.debit >= old.debit)) months.set(flow.m, flow);
  }
  return {
    daily: [...daily.values()].sort((a, b) => a.d.localeCompare(b.d)),
    monthly: [...months.values()].sort((a, b) => a.m.localeCompare(b.m)),
  };
}

/**
 * Applique un solde de relevé valide à l'état enregistré. Un relevé dont la date de solde est plus ancienne que celle du solde déjà enregistré
 * ne remplace jamais celui-ci (le refus est tracé). Un relevé valide efface la dernière erreur et remplace un solde manuel qui ne serait pas plus récent.
 */
export function applyValidImport(state: SoldeState, balance: StatementBalance, info: { fileName: string; importedAt: string; importedBy: string }): ImportDecision {
  const current = state.current;
  if (current && balance.balanceDate < current.balanceDate) {
    const message = `Le relevé ${info.fileName} s'arrête au ${balance.balanceDate}, plus ancien que le solde déjà enregistré (${current.balanceDate}) : il n'a pas remplacé le solde.`;
    return { action: "ignored", reason: "ancien", message, state: { ...state, rejection: { at: info.importedAt, fileName: info.fileName, reason: "ancien", message } } };
  }
  const stored: StoredBalance = { ...balance, ...mergeHistory(current, balance), ...info };
  const manual = state.manual && state.manual.date <= balance.balanceDate ? null : state.manual;
  return { action: "stored", state: { current: stored, manual, rejection: null } };
}

/** Trace le refus d'un relevé (structure, compte, incohérence) sans toucher au solde déjà enregistré. */
export function applyRefusedImport(state: SoldeState, refusal: { reason: BalanceRefusalKind; message: string; fileName: string; at: string }): SoldeState {
  return { ...state, rejection: { at: refusal.at, fileName: refusal.fileName, reason: refusal.reason, message: refusal.message } };
}

/**
 * Solde à afficher : celui du relevé importé ; le solde saisi à la main ne l'emporte que s'il est daté strictement après le relevé
 * (jamais un solde plus ancien). Renvoie null s'il n'existe aucun solde.
 */
export function resolveBalance(state: SoldeState): ResolvedBalance | null {
  const fromStatement: ResolvedBalance | null = state.current
    ? {
        source: "releve",
        balance: state.current.balance,
        date: state.current.balanceDate,
        lastOperationDate: state.current.lastOperationDate,
        fileName: state.current.fileName,
        savedAt: state.current.importedAt,
        savedBy: state.current.importedBy,
        sourceLabel: "relevé AGB importé",
      }
    : null;
  const manual: ManualBalance | null = state.manual;
  if (manual && (!fromStatement || manual.date > fromStatement.date)) {
    return { source: "manuel", balance: manual.balance, date: manual.date, lastOperationDate: null, fileName: "", savedAt: manual.savedAt, savedBy: manual.savedBy, sourceLabel: manual.source };
  }
  return fromStatement;
}

/** Niveau de fraîcheur du solde. */
export type FreshnessLevel = "ok" | "orange" | "rouge";

/**
 * Nombre de jours ouvrés (dimanche à jeudi : le week-end algérien est vendredi et samedi) entre la date du solde (exclue) et aujourd'hui (incluse).
 */
export function workingDaysBetween(from: string, to: string): number {
  let count = 0;
  for (let day = shiftIsoDate(from, 1); day <= to; day = shiftIsoDate(day, 1)) {
    const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
    if (weekday !== 5 && weekday !== 6) count += 1;
  }
  return count;
}

/** Fraîcheur : orange au-delà de 2 jours ouvrés, rouge au-delà de 5. */
export function freshness(balanceDate: string, today: string): { level: FreshnessLevel; workingDays: number } {
  const workingDays = workingDaysBetween(balanceDate, today);
  return { level: workingDays > 5 ? "rouge" : workingDays > 2 ? "orange" : "ok", workingDays };
}
