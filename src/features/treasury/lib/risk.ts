import { round2 } from "@/utils/amounts";
import { shiftIsoDate } from "@/utils/dates";
import { daysLabel, millions } from "@/features/treasury/lib/format";
import type { MonthlyFlow } from "@/features/treasury/types";

/** Nombre de jours d'un mois conventionnel pour passer du mois au jour. */
export const DAYS_PER_MONTH = 30;

/** Nombre de mois complets retenus pour mesurer les décaissements habituels. */
export const REFERENCE_MONTHS = 6;

/** Décaissements habituels mesurés dans les débits du relevé. */
export interface SpendingReference {
  /** Mois retenus (`AAAA-MM`), du plus ancien au plus récent. */
  months: string[];
  totalDebits: number;
  perMonth: number;
  /** Décaissement moyen journalier (moyenne mensuelle ÷ 30). */
  perDay: number;
}

const isLastDayOfMonth = (iso: string): boolean => shiftIsoDate(iso, 1).slice(0, 7) !== iso.slice(0, 7);

/**
 * Décaissement moyen des 6 derniers mois complets, calculé depuis les débits du relevé.
 * `dataEnd` est la date d'arrêt du relevé : son mois n'est complet que si c'est le dernier jour du mois. Renvoie null sans aucun mois complet.
 */
export function spendingReference(monthly: readonly MonthlyFlow[], dataEnd: string, historyStart: string | null = null): SpendingReference | null {
  const endMonth = dataEnd.slice(0, 7);
  // Le premier mois de l'historique est partiel si l'historique ne commence pas le 1er : il ne doit pas tirer la moyenne vers le bas.
  const partialFirst = historyStart !== null && historyStart.slice(8, 10) !== "01" ? historyStart.slice(0, 7) : null;
  const complete = monthly
    .filter((flow) => flow.m !== partialFirst && (flow.m < endMonth || (flow.m === endMonth && isLastDayOfMonth(dataEnd))))
    .sort((a, b) => a.m.localeCompare(b.m));
  const used = complete.slice(-REFERENCE_MONTHS);
  if (used.length === 0) return null;
  const totalDebits = round2(used.reduce((sum, flow) => sum + flow.debit, 0));
  const perMonth = totalDebits / used.length;
  return { months: used.map((flow) => flow.m), totalDebits, perMonth: round2(perMonth), perDay: perMonth / DAYS_PER_MONTH };
}

/** Réserve conseillée : `days` jours de décaissements moyens. Zéro sans historique. */
export function cushionAmount(reference: SpendingReference | null, days: number): number {
  return reference ? round2(reference.perDay * days) : 0;
}

/** Niveau de risque. */
export type RiskLevel = "vert" | "orange" | "rouge" | "indetermine";

/** Libellé court du niveau. */
export const RISK_TITLES: Readonly<Record<RiskLevel, string>> = {
  vert: "Situation confortable",
  orange: "Vigilance",
  rouge: "Risque de découvert",
  indetermine: "Indéterminé",
};

/** Entrées du niveau de risque. */
export interface RiskInput {
  /** Solde après tous les paiements (sans encaissement). */
  balanceAfter: number;
  /** Réserve conseillée. */
  cushion: number;
  /** Point bas de la chronologie. */
  lowest: number;
  /** Première date de découvert de la chronologie, ou null. */
  overdraftDate: string | null;
  /** Faux si l'historique des décaissements est insuffisant pour fixer une réserve : le niveau ne peut alors jamais être vert. Vrai par défaut. */
  historyKnown?: boolean;
}

/**
 * Niveau de risque. Rouge : solde après paiements négatif ou découvert sur la chronologie.
 * Orange : solde après paiements sous la réserve, ou point bas sous la réserve. Vert : le reste, mais seulement si l'historique permet de fixer la réserve ;
 * sans historique suffisant le niveau est « indéterminé » (jamais vert). Un découvert reste rouge, même sans historique.
 */
export function riskLevel(input: RiskInput): RiskLevel {
  if (input.balanceAfter < 0 || input.overdraftDate !== null || input.lowest < 0) return "rouge";
  if (input.historyKnown === false) return "indetermine";
  if (input.balanceAfter < input.cushion || input.lowest < input.cushion) return "orange";
  return "vert";
}

/** Verdict en phrase simple. */
export interface Verdict {
  level: RiskLevel;
  title: string;
  sentence: string;
}

/** Entrées du verdict. */
export interface VerdictInput extends RiskInput {
  /** Décaissement moyen journalier (0 si inconnu). */
  perDay: number;
  cushionDays: number;
  /** Date du point bas. */
  lowestDate: string | null;
}

/** Jours de couverture : solde après paiements ÷ décaissement moyen journalier ; null sans historique. */
export function coverageDays(balanceAfter: number, perDay: number): number | null {
  return perDay > 0 ? balanceAfter / perDay : null;
}

/** Phrase du verdict, en langage simple, selon le niveau de risque. */
export function buildVerdict(input: VerdictInput): Verdict {
  const level = riskLevel(input);
  const days = coverageDays(input.balanceAfter, input.perDay);
  const habit = days === null ? "" : `, soit environ ${daysLabel(Math.max(0, days))} de dépenses habituelles`;
  const reserve = `la réserve conseillée de ${input.cushionDays} jours (${millions(input.cushion)})`;
  let sentence: string;
  if (level === "rouge") {
    sentence =
      input.balanceAfter < 0
        ? `Après avoir tout payé, il manquerait ${millions(-input.balanceAfter)} : le compte serait à découvert${input.overdraftDate ? ` dès le ${input.overdraftDate.split("-").reverse().join("/")}` : ""}.`
        : `Le compte passerait à découvert le ${(input.overdraftDate ?? "").split("-").reverse().join("/")} (point bas : ${millions(input.lowest)}).`;
  } else if (level === "orange") {
    sentence =
      input.balanceAfter < input.cushion
        ? `Vous pouvez tout payer et il vous resterait ${millions(input.balanceAfter)}${habit}. C'est moins que ${reserve}.`
        : `Après tous les paiements, il resterait ${millions(input.balanceAfter)}, mais le solde descendrait à ${millions(input.lowest)}${input.lowestDate ? ` le ${input.lowestDate.split("-").reverse().join("/")}` : ""}, sous ${reserve}.`;
  } else if (level === "indetermine") {
    sentence = `Après avoir tout payé, il resterait ${millions(input.balanceAfter)}, mais l'historique du relevé est insuffisant pour fixer une réserve : le niveau de risque ne peut pas être établi. Importez un relevé couvrant au moins un mois complet.`;
  } else {
    sentence = `Après avoir tout payé, il resterait ${millions(input.balanceAfter)}${habit}, au-dessus de ${reserve}.`;
  }
  return { level, title: RISK_TITLES[level], sentence };
}

/** Point de la chronologie jour par jour. */
export interface TimelinePoint {
  date: string;
  /** Solde disponible prudent (sans encaissement). */
  balance: number;
  /** Solde avec les encaissements attendus (non garantis), ou null si l'option est désactivée. */
  expected: number | null;
}

/** Chronologie projetée. */
export interface Timeline {
  points: TimelinePoint[];
  lowest: { date: string; balance: number };
  /** Première date où le solde prudent est négatif, ou null. */
  overdraftDate: string | null;
}

/** Mouvement daté de la projection (paiement : montant positif à retirer ; encaissement : montant positif à ajouter). */
export interface Flow {
  date: string;
  montant: number;
}

/** Horizon maximal de la projection (jours après la date du solde). */
export const MAX_HORIZON_DAYS = 120;

/**
 * Chronologie jour par jour à partir de la date du solde : solde de départ, paiements retirés à leur date, encaissements attendus ajoutés à leur date
 * (série séparée, jamais mélangée au solde prudent). Un mouvement daté avant le départ est placé le jour du départ. L'horizon va jusqu'au dernier mouvement,
 * au moins 30 jours, au plus 120. Point bas et première date de découvert sont lus sur la série prudente.
 */
export function buildTimeline(start: string, startBalance: number, payments: readonly Flow[], collections: readonly Flow[] | null): Timeline {
  const clamp = (date: string): string => (date < start ? start : date);
  const last = [...payments, ...(collections ?? [])].reduce((max, flow) => (clamp(flow.date) > max ? clamp(flow.date) : max), start);
  let horizon = last > shiftIsoDate(start, 30) ? last : shiftIsoDate(start, 30);
  const cap = shiftIsoDate(start, MAX_HORIZON_DAYS);
  if (horizon > cap) horizon = cap;
  const place = (date: string): string => {
    const day = clamp(date);
    return day > horizon ? horizon : day;
  };
  const out = new Map<string, number>();
  const inn = new Map<string, number>();
  for (const flow of payments) out.set(place(flow.date), (out.get(place(flow.date)) ?? 0) + flow.montant);
  for (const flow of collections ?? []) inn.set(place(flow.date), (inn.get(place(flow.date)) ?? 0) + flow.montant);
  const points: TimelinePoint[] = [];
  let balance = startBalance;
  let expected = startBalance;
  let lowest = { date: start, balance: Number.POSITIVE_INFINITY };
  let overdraftDate: string | null = null;
  for (let date = start; date <= horizon; date = shiftIsoDate(date, 1)) {
    const paid = out.get(date) ?? 0;
    balance = round2(balance - paid);
    expected = round2(expected - paid + (inn.get(date) ?? 0));
    points.push({ date, balance, expected: collections ? expected : null });
    if (balance < lowest.balance) lowest = { date, balance };
    if (balance < 0 && overdraftDate === null) overdraftDate = date;
  }
  return { points, lowest, overdraftDate };
}
