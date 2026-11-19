import { chequeKeys, toCents } from "@/features/hr/lib/hr-duplicates";
import { dayGap } from "@/utils/dates";
import { upperPlain } from "@/utils/text";

/** Nombre minimal de chiffres d'un numéro de chèque cherché dans un libellé bancaire (évite de prendre une année pour un chèque). */
const MIN_BANK_CHEQUE_DIGITS = 5;

/** Écart de dates (jours) d'un rapprochement « moyen ». */
export const HR_BANK_NEAR_DAYS = 5;

/** Écart de dates (jours) au-delà duquel un montant identique seul n'est plus proposé. */
export const HR_BANK_WEAK_MAX_DAYS = 90;

/** Écriture RH à rapprocher du relevé. */
export interface HrBankEntry {
  id: string;
  legacyId?: string;
  sens: "PAIEMENT" | "RETOUR";
  mode: string;
  cheque: string;
  montant: number;
  date: string | null;
}

/** Ligne du relevé bancaire. */
export interface HrBankLine {
  id: string;
  date: string;
  libelle: string;
  numero?: string;
  montant: number;
  sens: "CREDIT" | "DEBIT";
  /** Références déjà portées par la ligne (« rh:<identifiant de l'écriture> » = lien explicite). */
  refs?: readonly string[];
}

/** Force d'un rapprochement : fort (chèque + montant ou lien explicite), moyen (montant + date à ±5 jours), faible (montant seul). */
export type HrBankLevel = "fort" | "moyen" | "faible";

/** Rapprochement d'une écriture avec une ligne du relevé. */
export interface HrBankMatch {
  entryId: string;
  lineId: string;
  level: HrBankLevel;
  /** Écart en jours entre la date de l'écriture et celle de la ligne (null si l'écriture n'a pas de date). */
  dateGap: number | null;
}

const SCORE: Readonly<Record<HrBankLevel, number>> = { fort: 3, moyen: 2, faible: 1 };

/** Numéros de chèque (zéros de tête retirés) lisibles dans un libellé bancaire ou une référence : « PAIEMENT CHEQUE N° TL-7064740 » donne « 7064740 ». */
export function bankChequeNumbers(libelle: string, numero = ""): string[] {
  const out: string[] = [];
  for (const run of upperPlain(`${libelle} ${numero}`).match(/\d+/g) ?? []) {
    const digits = run.replace(/^0+/, "");
    if (digits.length >= MIN_BANK_CHEQUE_DIGITS && !out.includes(digits)) out.push(digits);
  }
  return out;
}

/** Une écriture RH est-elle à rapprocher du relevé ? Paiement par chèque ou virement (« VIREMENT » : écritures transférées depuis une facture). */
export function isBankEntry(entry: Pick<HrBankEntry, "sens" | "mode">): boolean {
  return entry.sens === "PAIEMENT" && (entry.mode === "CHEQUE" || entry.mode === "VIRMT" || entry.mode === "VIREMENT");
}

/** Niveau de rapprochement d'une écriture avec une ligne, ou null si le montant diffère. */
export function levelOf(entry: HrBankEntry, line: HrBankLine): { level: HrBankLevel; dateGap: number | null } | null {
  const dateGap = entry.date && line.date ? dayGap(entry.date, line.date) : null;
  const linked = entry.legacyId !== undefined && (line.refs ?? []).includes(`rh:${entry.legacyId}`);
  const sameAmount = toCents(entry.montant) === toCents(line.montant);
  if (linked && Math.abs(entry.montant - line.montant) <= 0.5) return { level: "fort", dateGap };
  if (!sameAmount) return null;
  const numbers = bankChequeNumbers(line.libelle, line.numero);
  if (chequeKeys(entry.cheque).some((key) => key.length >= MIN_BANK_CHEQUE_DIGITS && numbers.includes(key))) return { level: "fort", dateGap };
  // Ligne déjà affectée à autre chose (facture non RH, autre écriture RH) : jamais proposée en rapprochement moyen ou faible.
  if ((line.refs ?? []).length > 0 && !linked) return null;
  if (dateGap !== null && dateGap <= HR_BANK_NEAR_DAYS) return { level: "moyen", dateGap };
  if (dateGap === null || dateGap <= HR_BANK_WEAK_MAX_DAYS) return { level: "faible", dateGap };
  return null;
}

/**
 * Rapproche chaque écriture RH (paiement par chèque ou virement) d'une ligne DEBIT du relevé.
 * Fort : numéro de chèque normalisé présent dans le libellé bancaire et montant identique (ou lien « rh: » déjà posé).
 * Moyen : montant identique et date à ±5 jours. Faible : montant identique seul (au plus 90 jours d'écart).
 * Les lignes déjà affectées (références autres que « rh:<cette écriture> ») ne sont candidates qu'en rapprochement fort.
 * Appariement glouton : les couples sont pris par force décroissante puis par écart de dates croissant ; une ligne ne sert qu'à une seule écriture.
 * Lecture seule : aucune écriture en base.
 */
export function matchHrToBank(entries: readonly HrBankEntry[], lines: readonly HrBankLine[]): Map<string, HrBankMatch> {
  const debits = lines.filter((line) => line.sens === "DEBIT");
  const pairs: HrBankMatch[] = [];
  for (const entry of entries) {
    if (!isBankEntry(entry)) continue;
    for (const line of debits) {
      const found = levelOf(entry, line);
      if (found) pairs.push({ entryId: entry.id, lineId: line.id, level: found.level, dateGap: found.dateGap });
    }
  }
  pairs.sort(
    (a, b) =>
      SCORE[b.level] - SCORE[a.level] ||
      (a.dateGap ?? 9999) - (b.dateGap ?? 9999) ||
      a.entryId.localeCompare(b.entryId) ||
      a.lineId.localeCompare(b.lineId),
  );
  const result = new Map<string, HrBankMatch>();
  const usedLines = new Set<string>();
  for (const pair of pairs) {
    if (result.has(pair.entryId) || usedLines.has(pair.lineId)) continue;
    result.set(pair.entryId, pair);
    usedLines.add(pair.lineId);
  }
  return result;
}

/**
 * Règle forte seule, pour l'analyse d'un relevé importé : associe à chaque ligne DEBIT l'écriture RH (chèque) dont le numéro
 * figure dans le libellé et dont le montant est identique. Une écriture ne sert qu'à une ligne. Renvoie l'identifiant de l'écriture par ligne.
 */
export function strongHrMatches(lines: readonly HrBankLine[], entries: readonly HrBankEntry[]): Map<string, string> {
  const result = new Map<string, string>();
  const used = new Set<string>();
  for (const line of lines) {
    if (line.sens !== "DEBIT") continue;
    const entry = entries.find((candidate) => !used.has(candidate.id) && isBankEntry(candidate) && levelOf(candidate, line)?.level === "fort");
    if (!entry) continue;
    used.add(entry.id);
    result.set(line.id, entry.id);
  }
  return result;
}
