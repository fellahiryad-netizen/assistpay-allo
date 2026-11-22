import { round2 } from "@/utils/amounts";
import { daysBetween } from "@/utils/dates";

/** Anomalie de date dans une écriture RH (lecture seule). */
export interface HrDateAnomaly {
  id: string;
  nature: string;
  libelle: string;
  montant: number;
  date: string | null;
  reason: "sans_date" | "date_absurde";
}

/** Écriture RH réduite aux champs utiles. */
export interface HrDateEntry {
  id: string;
  nature: string;
  libelle: string;
  montant: number;
  date: string | null;
}

/** Une date est absurde si elle est antérieure à 2015 ou postérieure de plus d'un an à aujourd'hui (ex. 05/03/2028 saisi pour 2026). */
export function isAbsurdDate(date: string, today: string): boolean {
  return date < "2015-01-01" || daysBetween(today, date) > 366;
}

/** Écritures RH sans date ou à date absurde. Ne modifie rien. */
export function hrDateAnomalies(entries: readonly HrDateEntry[], today: string): HrDateAnomaly[] {
  const out: HrDateAnomaly[] = [];
  for (const entry of entries) {
    if (entry.date === null) out.push({ ...entry, reason: "sans_date" });
    else if (isAbsurdDate(entry.date, today)) out.push({ ...entry, reason: "date_absurde" });
  }
  return out;
}

/** Écart entre le relevé importé et le journal du CRM. */
export interface LedgerGap {
  /** Solde recalculé depuis les lignes du CRM : départ + crédits − débits. */
  recomputed: number;
  /** Solde du relevé − solde recalculé (positif : le relevé a davantage). */
  gap: number;
}

/** Écart relevé / journal CRM : départ du relevé + crédits du CRM − débits du CRM, comparé au solde du relevé. */
export function ledgerGap(statementBalance: number, opening: number, crmCredits: number, crmDebits: number): LedgerGap {
  const recomputed = round2(opening + crmCredits - crmDebits);
  return { recomputed, gap: round2(statementBalance - recomputed) };
}
