import { dayGap, MONTHS_FR } from "@/utils/dates";
import { formatDA, formatDate } from "@/utils/format";
import type { BankDebit } from "@/features/treasury/lib/circulation";
import type { SimType } from "@/features/treasury/types";

/** Écriture RH réduite aux champs utiles à la détection et aux suggestions (paiements seulement). */
export interface HrLite {
  id: string;
  nature: string;
  /** Mois de rattachement `AAAA-MM` ou chaîne vide. */
  monthKey: string;
  date: string | null;
  montant: number;
  libelle: string;
  beneficiaire: string;
}

/** Ligne à contrôler (ligne de simulation ou saisie en cours). */
export interface DuplicateCandidate {
  type: SimType;
  periode: string;
  date: string;
  montant: number;
}

/** Doublon repéré : dans le RH ou dans le relevé. */
export interface DuplicateHit {
  kind: "rh" | "banque";
  refId: string;
  message: string;
}

/** Tolérance de montant de l'anti-doublon. */
export const DUPLICATE_AMOUNT_TOLERANCE = 0.01;

/** Fenêtre de dates (jours) de l'anti-doublon par montant. */
export const DUPLICATE_WINDOW_DAYS = 45;

const NATURE_PATTERNS: Readonly<Record<SimType, RegExp | null>> = {
  CNAS: /CNAS|CASNOS/i,
  G50: /G50/i,
  IRG_IBS: /\bIRG\b|\bIBS\b/i,
  SALAIRES: /SALAIRE/i,
  AUTRE: null,
};

const near = (a: number, b: number): boolean => Math.abs(a - b) <= Math.abs(b) * DUPLICATE_AMOUNT_TOLERANCE;

const describe = (entry: HrLite): string => `${entry.nature} ${entry.libelle || entry.beneficiaire}`.replace(/\s+/g, " ").trim();

/**
 * Anti-doublon d'une ligne de simulation. Avec le RH (même année en pratique) : même nature et même mois de rattachement, ou montant égal à ± 1 % à ± 45 jours.
 * Avec le relevé : débit postérieur à la date du solde, de même montant (± 1 %) et de libellé de même nature, ou de montant identique au centime.
 * Ne supprime rien : renvoie seulement les rapprochements trouvés.
 */
export function findDuplicates(candidate: DuplicateCandidate, hr: readonly HrLite[], debits: readonly BankDebit[], balanceDate: string): DuplicateHit[] {
  const hits: DuplicateHit[] = [];
  const pattern = NATURE_PATTERNS[candidate.type];
  const month = candidate.periode || candidate.date.slice(0, 7);
  for (const entry of hr) {
    const sameNatureAndMonth = pattern !== null && pattern.test(entry.nature) && entry.monthKey !== "" && entry.monthKey === month;
    const sameAmount = entry.date !== null && near(entry.montant, candidate.montant) && dayGap(entry.date, candidate.date) <= DUPLICATE_WINDOW_DAYS;
    if (sameNatureAndMonth || sameAmount) {
      hits.push({ kind: "rh", refId: entry.id, message: `Ce paiement semble déjà enregistré dans le RH (${describe(entry)}, ${formatDA(entry.montant)}${entry.date ? `, le ${formatDate(entry.date).slice(0, 5)}` : ""}).` });
    }
  }
  for (const debit of debits) {
    if (debit.date <= balanceDate) continue;
    const sameNature = pattern !== null && pattern.test(debit.libelle);
    if ((near(debit.montant, candidate.montant) && sameNature) || Math.abs(debit.montant - candidate.montant) <= 0.01) {
      hits.push({ kind: "banque", refId: `${debit.date}|${debit.montant}`, message: `Déjà passé en banque après la date du solde : ${debit.libelle.trim()}, ${formatDA(debit.montant)}, le ${formatDate(debit.date)}.` });
    }
  }
  return hits;
}

/** Suggestion non automatique pour une ligne de simulation. */
export interface Suggestion {
  last: { montant: number; label: string } | null;
  average: { montant: number; months: number } | null;
}

/** Libellé d'un mois « AAAA-MM » : « octobre 2026 ». */
export function monthLabel(month: string): string {
  const name = MONTHS_FR[Number(month.slice(5, 7)) - 1];
  return name ? `${name.toLowerCase()} ${month.slice(0, 4)}` : month;
}

/**
 * Suggestion : dernier mois connu de la nature et moyenne mensuelle des 6 derniers mois connus (total par mois de rattachement).
 * Jamais appliquée seule : la comptable clique « Utiliser cette valeur ».
 */
export function suggestFor(type: SimType, hr: readonly HrLite[]): Suggestion {
  const pattern = NATURE_PATTERNS[type];
  if (!pattern) return { last: null, average: null };
  const perMonth = new Map<string, number>();
  for (const entry of hr) {
    if (!pattern.test(entry.nature) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(entry.monthKey)) continue;
    perMonth.set(entry.monthKey, (perMonth.get(entry.monthKey) ?? 0) + entry.montant);
  }
  const months = [...perMonth.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  const first = months[0];
  const recent = months.slice(0, 6);
  return {
    last: first ? { montant: Math.round(first[1] * 100) / 100, label: monthLabel(first[0]) } : null,
    average: recent.length ? { montant: Math.round((recent.reduce((sum, [, value]) => sum + value, 0) / recent.length) * 100) / 100, months: recent.length } : null,
  };
}
