import { round2 } from "@/utils/amounts";
import { dayGap, daysBetween } from "@/utils/dates";

/** Chèque émis (écriture RH ou facture fournisseur réglée par chèque, avec numéro). */
export interface IssuedCheque {
  source: "rh" | "facture";
  id: string;
  /** Numéro tel que saisi (« TL-7064745 »). */
  numero: string;
  montant: number;
  /** Date d'émission `AAAA-MM-JJ`, ou null. */
  date: string | null;
  beneficiaire: string;
  libelle: string;
}

/** Ligne de débit du relevé. */
export interface BankDebit {
  date: string;
  libelle: string;
  numero: string;
  montant: number;
}

/** Écart (en jours) toléré entre l'émission d'un chèque et un débit de même montant. */
export const CHEQUE_AMOUNT_WINDOW_DAYS = 10;

/** Au-delà de ce nombre de jours sans débit, un chèque n'est plus tenu pour « en circulation » mais « à vérifier ». */
export const CHEQUE_STALE_DAYS = 90;

/** Chiffres d'un numéro de chèque (« TL-7064745 » → « 7064745 ») ; vide si moins de 4 chiffres. */
export function chequeDigits(numero: string): string {
  const digits = numero.replace(/\D/g, "");
  return digits.length >= 4 ? digits : "";
}

/** Statut d'un chèque face au relevé. */
export type ChequeStatus = "debite" | "circulation" | "a_verifier" | "hors_releve";

/** Chèque et son statut. */
export interface ChequeCheck {
  cheque: IssuedCheque;
  status: ChequeStatus;
  /** Date du débit trouvé. */
  debitDate: string | null;
  matchedBy: "numero" | "montant" | null;
}

/** Cherche le débit d'un chèque : libellé « … TL-<numéro> », sinon débit de même montant à ± 10 jours. */
export function findChequeDebit(cheque: IssuedCheque, debits: readonly BankDebit[]): { debit: BankDebit; by: "numero" | "montant" } | null {
  const digits = chequeDigits(cheque.numero);
  if (digits) {
    const pattern = new RegExp(`(?<!\\d)${digits}(?!\\d)`);
    const byNumber = debits.find((debit) => pattern.test(`${debit.libelle} ${debit.numero}`));
    if (byNumber) return { debit: byNumber, by: "numero" };
  }
  if (cheque.date) {
    const issued = cheque.date;
    const byAmount = debits.find((debit) => Math.abs(debit.montant - cheque.montant) <= 0.01 && dayGap(debit.date, issued) <= CHEQUE_AMOUNT_WINDOW_DAYS);
    if (byAmount) return { debit: byAmount, by: "montant" };
  }
  return null;
}

/** Fusionne les chèques de même numéro : l'écriture RH l'emporte ; sinon les factures du même chèque s'additionnent. */
export function mergeCheques(cheques: readonly IssuedCheque[]): IssuedCheque[] {
  const byNumber = new Map<string, IssuedCheque[]>();
  const rest: IssuedCheque[] = [];
  for (const cheque of cheques) {
    const key = chequeDigits(cheque.numero);
    if (!key) {
      rest.push(cheque);
      continue;
    }
    byNumber.set(key, [...(byNumber.get(key) ?? []), cheque]);
  }
  const merged: IssuedCheque[] = [];
  for (const group of byNumber.values()) {
    const hr = group.find((cheque) => cheque.source === "rh");
    if (hr) {
      merged.push(hr);
      continue;
    }
    const first = group[0];
    if (!first) continue;
    merged.push({ ...first, montant: round2(group.reduce((sum, cheque) => sum + cheque.montant, 0)), date: group.map((c) => c.date).filter((d): d is string => d !== null).sort()[0] ?? null });
  }
  return [...merged, ...rest];
}

/** Résultat du contrôle des chèques émis. */
export interface ChequeReport {
  checks: ChequeCheck[];
  /** Chèques en circulation (à déduire du solde bancaire). */
  circulation: IssuedCheque[];
  /** Total des chèques en circulation. */
  total: number;
  /** Chèques sans débit retrouvé mais trop anciens, sans date ou antérieurs au relevé : à vérifier, non déduits. */
  toVerify: IssuedCheque[];
}

/**
 * Chèques émis non débités : pour chaque chèque, le relevé est cherché par numéro puis par montant à ± 10 jours.
 * Trouvé : déjà dans le solde. Sinon : en circulation (à déduire) s'il est daté dans la période couverte par le relevé et depuis moins de 90 jours ;
 * sinon « à vérifier » (non déduit, signalé aux contrôles).
 * `coverageStart` : première date du relevé disponible dans le CRM ; un chèque antérieur ne peut pas être contrôlé.
 */
export function chequesInCirculation(issued: readonly IssuedCheque[], debits: readonly BankDebit[], today: string, coverageStart: string | null): ChequeReport {
  const checks: ChequeCheck[] = mergeCheques(issued).map((cheque) => {
    const found = findChequeDebit(cheque, debits);
    if (found) return { cheque, status: "debite" as const, debitDate: found.debit.date, matchedBy: found.by };
    if (!cheque.date || !coverageStart || cheque.date < coverageStart) return { cheque, status: "a_verifier" as const, debitDate: null, matchedBy: null };
    if (daysBetween(cheque.date, today) > CHEQUE_STALE_DAYS) return { cheque, status: "a_verifier" as const, debitDate: null, matchedBy: null };
    return { cheque, status: "circulation" as const, debitDate: null, matchedBy: null };
  });
  const circulation = checks.filter((check) => check.status === "circulation").map((check) => check.cheque);
  return { checks, circulation, total: round2(circulation.reduce((sum, cheque) => sum + cheque.montant, 0)), toVerify: checks.filter((check) => check.status === "a_verifier").map((check) => check.cheque) };
}
