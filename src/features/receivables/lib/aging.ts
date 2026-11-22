import { daysBetween } from "@/utils/dates";

/** Tranche d'ancienneté d'une créance. */
export type AgingKey = "D0_30" | "D31_60" | "D61_90" | "D90_PLUS" | "SANS_DATE";

/** Tranches affichées, dans l'ordre. Les trois premières limites (30, 60, 90 jours) sont celles du tableau de bord. */
export const AGING_BUCKETS: ReadonlyArray<{ key: AgingKey; label: string; max: number }> = [
  { key: "D0_30", label: "0 – 30 j", max: 30 },
  { key: "D31_60", label: "31 – 60 j", max: 60 },
  { key: "D61_90", label: "61 – 90 j", max: 90 },
  { key: "D90_PLUS", label: "Plus de 90 j", max: Number.POSITIVE_INFINITY },
  { key: "SANS_DATE", label: "Sans date", max: Number.POSITIVE_INFINITY },
];

/**
 * Ancienneté en jours : depuis la date de facture, à défaut la date d'opération (comme le tableau de bord).
 * `null` si la facture n'a aucune date. Jamais négative.
 */
export function ageInDays(dateFacture: string | null, dateOperation: string | null, today: string): number | null {
  const since = dateFacture ?? dateOperation;
  if (!since) return null;
  return Math.max(0, daysBetween(since, today));
}

/** Tranche d'une ancienneté ; `null` (aucune date) → « Sans date ». */
export function agingKeyOf(age: number | null): AgingKey {
  if (age === null) return "SANS_DATE";
  const found = AGING_BUCKETS.find((bucket) => bucket.key !== "SANS_DATE" && age <= bucket.max);
  return found ? found.key : "D90_PLUS";
}
