/** Natures classées dans le mois de la période qu'elles couvrent (et non dans le mois de paiement) : G50, IRG, IBS. */
export const PERIOD_NATURES = /^(G50|IRG|IBS)$/i;

/** Vrai si la nature se classe par période couverte. */
export function isPeriodNature(nature: string): boolean {
  return PERIOD_NATURES.test(nature.trim());
}

/** Période « AAAA-MM » valide saisie sur l'écriture, sinon chaîne vide. */
export function validPeriod(mois: string): string {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(mois.trim()) ? mois.trim() : "";
}
