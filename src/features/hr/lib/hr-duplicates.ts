import { dayGap } from "@/utils/dates";
import { formatDA, formatDate } from "@/utils/format";
import { upperPlain } from "@/utils/text";

/** Début du message d'un doublon probable (l'écran s'en sert pour proposer la case de confirmation). */
export const HR_PROBABLE_PREFIX = "Doublon probable";

/** Écart maximal (en jours) entre deux écritures de même nature et même montant pour parler de doublon probable. */
export const HR_PROBABLE_WINDOW_DAYS = 45;

/** Nombre minimal de chiffres d'un numéro de chèque retenu pour la comparaison. */
const MIN_CHEQUE_DIGITS = 4;

/** Écriture RH réduite aux champs utiles à la détection. */
export interface HrEntryLike {
  id?: string;
  nature: string;
  sens: "PAIEMENT" | "RETOUR";
  beneficiaire: string;
  /** Mois concerné, `AAAA-MM`. */
  mois: string;
  /** Date de paiement `AAAA-MM-JJ` ou null. */
  date: string | null;
  montant: number;
  cheque: string;
  libelle: string;
}

/** Niveau d'un doublon : certain (refus définitif) ou probable (confirmation possible). */
export type HrDuplicateLevel = "certain" | "probable";

/** Doublon repéré. */
export interface HrDuplicate {
  level: HrDuplicateLevel;
  entry: HrEntryLike;
  reason: string;
}

/** Montant en centimes (comparaison exacte, sans erreur d'arrondi flottant). */
export function toCents(value: number): number {
  return Math.round(value * 100);
}

/**
 * Numéros de chèque normalisés d'une saisie : on retire les lettres (« TL- », « AGB », « CHQ »…), les espaces et les
 * séparateurs, puis les zéros de tête. Plusieurs chèques peuvent être séparés par « / », « & », « + », « , » ou « ; ».
 * Les numéros de moins de 4 chiffres sont ignorés.
 */
export function chequeKeys(raw: string): string[] {
  const keys: string[] = [];
  for (const part of upperPlain(raw).split(/[/&+,;]/)) {
    const digits = part.replace(/\D/g, "").replace(/^0+/, "");
    if (digits.length >= MIN_CHEQUE_DIGITS && !keys.includes(digits)) keys.push(digits);
  }
  return keys;
}

/** Premier numéro de chèque normalisé (« TL-7064740 » et « 7064740 » donnent « 7064740 »), ou chaîne vide. */
export function normalizeCheque(raw: string): string {
  return chequeKeys(raw)[0] ?? "";
}

/** Nom normalisé pour comparaison : majuscules, sans accents ni ponctuation, espaces réduits. */
export function normalizeBeneficiary(value: string): string {
  return upperPlain(value)
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

/** Natures versées à un organisme (le bénéficiaire peut varier d'une saisie à l'autre) : G50, IRG, IBS, CNAS, CASNOS. */
export function isOrganismNature(nature: string): boolean {
  return /^(G50|IRG|IBS|CNAS|CASNOS)$/.test(upperPlain(nature).trim());
}

const MONTH_WORDS: ReadonlyArray<readonly [number, string]> = [
  [1, "JANV(?:IER)?"],
  [2, "FEV(?:R|RIER)?"],
  [3, "MARS"],
  [4, "AVR(?:IL)?"],
  [5, "MAI"],
  [6, "JUIN"],
  [7, "JUIL(?:LET)?"],
  [8, "AOUT"],
  [9, "SEPT(?:EMBRE)?"],
  [10, "OCT(?:OBRE)?"],
  [11, "NOV(?:EMBRE)?"],
  [12, "DEC(?:EMBRE)?"],
];

const pad = (month: number): string => String(month).padStart(2, "0");

/**
 * Périodes (`AAAA-MM`) citées dans un libellé : « G50 09-2026 », « 2026/09 », « septembre », « aout »…
 * Un mois sans année est rattaché à l'année de `reference` (mois ou date de l'écriture) ; s'il est postérieur au mois de
 * référence, c'est celui de l'année précédente (un G50 de décembre payé en janvier). Une date complète (« 19/10/2026 ») n'est pas une période.
 */
export function citedPeriods(libelle: string, reference: string): string[] {
  const text = upperPlain(libelle);
  const found: string[] = [];
  const add = (key: string): void => {
    if (!found.includes(key)) found.push(key);
  };
  for (const match of text.matchAll(/(?<!\d[/.-])(?<!\d)(0?[1-9]|1[0-2])[/.-](20\d{2})(?!\d)/g)) add(`${match[2]}-${pad(Number(match[1]))}`);
  for (const match of text.matchAll(/(?<!\d)(20\d{2})[/.-](0[1-9]|1[0-2])(?![\d/.-]\d)/g)) add(`${match[1]}-${match[2]}`);
  const refYear = Number(reference.slice(0, 4)) || new Date().getUTCFullYear();
  const refMonth = Number(reference.slice(5, 7)) || 12;
  for (const [month, word] of MONTH_WORDS) {
    const hit = text.match(new RegExp(`\\b${word}\\b(?:\\s*(20\\d{2}))?`));
    if (!hit) continue;
    add(`${hit[1] ?? (month <= refMonth ? refYear : refYear - 1)}-${pad(month)}`);
  }
  return found;
}

/** Mois de référence d'une écriture : mois de la date de paiement, sinon mois saisi. */
export function referenceMonth(entry: Pick<HrEntryLike, "date" | "mois">): string {
  return (entry.date ?? "").slice(0, 7) || entry.mois;
}

/** Périodes citées explicitement dans le libellé de l'écriture (liste vide si le libellé n'en cite pas). */
export function explicitPeriods(entry: Pick<HrEntryLike, "libelle" | "date" | "mois">): string[] {
  return citedPeriods(entry.libelle, referenceMonth(entry));
}

/** Période de l'écriture : celle du libellé si elle y figure, sinon le mois saisi. */
export function entryPeriods(entry: Pick<HrEntryLike, "libelle" | "date" | "mois">): string[] {
  const explicit = explicitPeriods(entry);
  if (explicit.length) return explicit;
  const fallback = entry.mois || (entry.date ?? "").slice(0, 7);
  return fallback ? [fallback] : [];
}

const intersects = (a: string[], b: string[]): boolean => a.some((value) => b.includes(value));

function sameCheque(a: HrEntryLike, b: HrEntryLike): boolean {
  const keys = chequeKeys(a.cheque);
  return keys.length > 0 && chequeKeys(b.cheque).some((key) => keys.includes(key));
}

/**
 * Compare deux écritures. Renvoie le niveau du doublon, ou null.
 *
 * Certain : même chèque normalisé et même montant ; ou même nature, même montant, même bénéficiaire normalisé et même date.
 * Probable (sens identique, même montant au centime) :
 * - même nature à moins de 45 jours ;
 * - ou même groupe de nature dont la période (libellé, sinon mois) coïncide.
 * Pour les natures individuelles (salaire, avance, prime…), le bénéficiaire doit aussi être le même (deux salaires identiques
 * de deux employés ne sont pas un doublon) et la période doit coïncider (le salaire d'un employé est souvent identique d'un mois à l'autre).
 * Pour les organismes (G50, IRG, CNAS…), le bénéficiaire n'est pas comparé : c'est justement lui qui varie quand la saisie est répétée.
 * Si les deux libellés citent chacun une période et que ces périodes diffèrent, ce n'est pas un doublon probable.
 */
export function compareHrEntries(candidate: HrEntryLike, other: HrEntryLike): HrDuplicate | null {
  if (candidate.sens !== other.sens || toCents(candidate.montant) !== toCents(other.montant)) return null;
  const sameNature = upperPlain(candidate.nature) === upperPlain(other.nature);
  if (sameCheque(candidate, other)) return { level: "certain", entry: other, reason: "même chèque et même montant" };
  const sameBeneficiary = normalizeBeneficiary(candidate.beneficiaire) !== "" && normalizeBeneficiary(candidate.beneficiaire) === normalizeBeneficiary(other.beneficiaire);
  if (sameNature && sameBeneficiary && candidate.date && candidate.date === other.date) return { level: "certain", entry: other, reason: "même nature, même montant, même bénéficiaire et même date" };

  const organism = isOrganismNature(candidate.nature) && isOrganismNature(other.nature);
  if (!organism && !sameBeneficiary) return null;
  const explicitA = explicitPeriods(candidate);
  const explicitB = explicitPeriods(other);
  if (explicitA.length && explicitB.length && !intersects(explicitA, explicitB)) return null;
  const periodsMatch = intersects(entryPeriods(candidate), entryPeriods(other));
  if (organism && sameNature && candidate.date && other.date && dayGap(candidate.date, other.date) <= HR_PROBABLE_WINDOW_DAYS) {
    return { level: "probable", entry: other, reason: `même nature et même montant à ${dayGap(candidate.date, other.date)} jour(s) d'écart` };
  }
  if ((organism ? isSameGroup(candidate.nature, other.nature) : sameNature) && periodsMatch) {
    return { level: "probable", entry: other, reason: "même montant et même période" };
  }
  return null;
}

function isSameGroup(a: string, b: string): boolean {
  const group = (nature: string): string => (/CNAS|CASNOS/i.test(nature) ? "cnas" : "impots");
  return group(a) === group(b);
}

/** Cherche, parmi les écritures existantes, le doublon le plus fort (certain avant probable, puis date la plus proche). `excludeId` écarte l'écriture modifiée. */
export function findHrDuplicate(candidate: HrEntryLike, existing: readonly HrEntryLike[], excludeId?: string): HrDuplicate | null {
  let best: HrDuplicate | null = null;
  let bestGap = Number.POSITIVE_INFINITY;
  for (const entry of existing) {
    if (excludeId && entry.id === excludeId) continue;
    const found = compareHrEntries(candidate, entry);
    if (!found) continue;
    const gap = candidate.date && entry.date ? dayGap(candidate.date, entry.date) : 9999;
    if (!best || (found.level === "certain" && best.level === "probable") || (found.level === best.level && gap < bestGap)) {
      best = found;
      bestGap = gap;
    }
  }
  return best;
}

/** Décrit une écriture existante pour un message : date, libellé, chèque, montant. */
export function describeHrEntry(entry: HrEntryLike): string {
  const parts = [entry.date ? `du ${formatDate(entry.date)}` : "sans date", `${entry.nature} – ${entry.beneficiaire || "sans bénéficiaire"}`];
  if (entry.libelle) parts.push(`libellé « ${entry.libelle} »`);
  const cheque = chequeKeys(entry.cheque)[0] ? entry.cheque : "";
  if (cheque) parts.push(`chèque ${cheque}`);
  parts.push(formatDA(entry.montant));
  return parts.join(", ");
}

/**
 * Message en français d'un refus pour doublon (« Doublon probable » ouvre la confirmation, « Doublon » seul est définitif).
 * `canConfirm` : l'écran propose une case de confirmation (saisie RH) ; sinon le message renvoie vers l'onglet RH.
 */
export function duplicateMessage(duplicate: HrDuplicate, canConfirm = true): string {
  const existing = describeHrEntry(duplicate.entry);
  if (duplicate.level === "certain") {
    return `Doublon : cette écriture existe déjà (${duplicate.reason}) : ${existing}. Modifiez l'écriture existante ou supprimez-la avant d'en enregistrer une autre.`;
  }
  return `${HR_PROBABLE_PREFIX} (${duplicate.reason}) : écriture ${existing}. Corrigez l'écriture existante ou supprimez l'ancienne ; ${canConfirm ? "s'il s'agit bien d'un paiement distinct, cochez la case de confirmation puis enregistrez de nouveau." : "s'il s'agit bien d'un paiement distinct, saisissez-le directement depuis l'onglet RH et confirmez-le."}`;
}

/** Vrai si le message d'erreur est celui d'un doublon probable (confirmation possible). */
export function isProbableDuplicateMessage(message: string): boolean {
  return message.startsWith(HR_PROBABLE_PREFIX);
}
