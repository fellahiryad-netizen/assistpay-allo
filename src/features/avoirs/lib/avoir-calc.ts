/** Calculs propres aux factures d'avoir (aucune règle de calcul des factures n'est modifiée ici). */

const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

/** Montants d'un avoir, en valeur positive (le document les affiche en négatif). */
export interface AvoirAmounts {
  ht: number;
  tva: number;
  ttc: number;
}

/**
 * Montants d'un avoir sur une facture d'origine.
 * Avoir total : les montants exacts de la facture. Avoir partiel : le TTC saisi est réparti entre HT et TVA
 * dans les mêmes proportions que la facture d'origine (la TVA de l'avoir suit donc celle de la facture).
 */
export function avoirAmounts(origin: AvoirAmounts, mode: "total" | "partiel", ttcPartiel?: number): AvoirAmounts {
  if (mode === "total" || ttcPartiel === undefined) return { ht: round2(origin.ht), tva: round2(origin.tva), ttc: round2(origin.ttc) };
  const ttc = round2(ttcPartiel);
  if (!(origin.ttc > 0)) return { ht: ttc, tva: 0, ttc };
  const ht = round2((origin.ht * ttc) / origin.ttc);
  return { ht, tva: round2(ttc - ht), ttc };
}

/** Reste que l'on peut encore passer en avoir sur une facture. */
export function remainingAvoirable(originTtc: number, avoirsTtc: readonly number[]): number {
  return Math.max(0, round2(originTtc - avoirsTtc.reduce((sum, value) => sum + Math.abs(value), 0)));
}

const AVOIR_NUMBER = /^AV\/(\d{4})\/(\d{4,})$/;

/** Prochain numéro de la série « AV/AAAA/0001 » (une série par année, toutes compagnies confondues). */
export function nextAvoirNumber(existing: readonly string[], year: number): string {
  let max = 0;
  for (const value of existing) {
    const match = AVOIR_NUMBER.exec(value.trim());
    if (match && Number(match[1]) === year) max = Math.max(max, Number(match[2]));
  }
  return `AV/${year}/${String(max + 1).padStart(4, "0")}`;
}
