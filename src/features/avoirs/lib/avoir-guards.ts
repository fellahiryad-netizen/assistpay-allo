/** Garde-fous propres aux avoirs (date, plafond HT). Aucune règle de calcul des factures n'est modifiée ici. */

const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

/** Tolérance (en DA) sur le plafond HT cumulé. */
export const HT_TOLERANCE = 0.02;

/** Vrai si `iso` (AAAA-MM-JJ) est une vraie date du calendrier (le 2026-02-31 est refusé). */
export function isRealIsoDate(iso: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/**
 * Contrôle la date d'un avoir : date réelle, pas dans le futur, pas d'une année antérieure à l'année en cours
 * (le numéro AV suit l'année de la date), pas avant la facture d'origine. Renvoie le message d'erreur, ou null si la date est valable.
 * `today` est la date du jour à Alger (AAAA-MM-JJ).
 */
export function validateAvoirDate(date: string, today: string, originDate: string | null): string | null {
  if (!isRealIsoDate(date)) return `La date de l'avoir (${date}) n'existe pas dans le calendrier. Vérifiez le jour et le mois.`;
  if (date > today) return "La date de l'avoir ne peut pas être postérieure à aujourd'hui.";
  if (Number(date.slice(0, 4)) < Number(today.slice(0, 4))) {
    return `La date de l'avoir ne peut pas appartenir à une année antérieure à ${today.slice(0, 4)} : le numéro d'avoir suit l'année de la date et l'ordre chronologique serait faussé.`;
  }
  if (originDate && date < originDate) return "La date de l'avoir ne peut pas précéder celle de la facture.";
  return null;
}

/**
 * Plafond HT cumulé : le HT des avoirs actifs déjà émis plus le HT de ce nouvel avoir ne doit pas dépasser le HT de la facture d'origine
 * (tolérance de 0,02 DA). Les montants sont en valeur absolue. Renvoie le message d'erreur, ou null si le plafond est respecté.
 */
export function checkHtCeiling(originHt: number, existingHt: readonly number[], newHt: number): string | null {
  const already = round2(existingHt.reduce((sum, value) => sum + Math.abs(value), 0));
  const total = round2(already + Math.abs(newHt));
  if (total <= round2(originHt) + HT_TOLERANCE) return null;
  const room = Math.max(0, round2(originHt - already));
  return `Le cumul HT des avoirs (${already.toFixed(2)} + ${Math.abs(newHt).toFixed(2)} = ${total.toFixed(2)} DA) dépasserait le HT de la facture d'origine (${round2(originHt).toFixed(2)} DA). HT encore avoirable : ${room.toFixed(2)} DA. Pour solder la facture, utilisez le mode « total ».`;
}
