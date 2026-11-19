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

/** Champs d'une écriture RH utiles au classement par année et par mois. */
export interface HrPeriodFields {
  nature: string;
  /** Mois concerné saisi (`AAAA-MM`, éventuellement vide ou invalide). */
  mois: string;
  /** Année enregistrée, si elle existe. */
  annee: number | null;
  /** Date de paiement `AAAA-MM-JJ` ou null. */
  date: string | null;
}

/** Année de rattachement : pour un G50 / IRG / IBS, celle de la période couverte (si le mois est valide) ; sinon l'année enregistrée, à défaut celle du mois ou de la date. */
export function yearOfEntry(entry: HrPeriodFields): number {
  const period = isPeriodNature(entry.nature) ? validPeriod(entry.mois) : "";
  if (period) return Number(period.slice(0, 4));
  return entry.annee ?? (Number((entry.mois || entry.date || "").slice(0, 4)) || 0);
}

/**
 * Année à enregistrer sur une écriture : celle de la période pour G50 / IRG / IBS (mois valide), sinon celle de la date de paiement, à défaut du mois.
 */
export function storedYear(nature: string, mois: string, date: string | null): number {
  const period = isPeriodNature(nature) ? validPeriod(mois) : "";
  return Number((period || date || mois).slice(0, 4));
}

/**
 * Mois de rattachement. G50, IRG et IBS : le mois de la période couverte (mois valide).
 * Autres natures : mois de la date si elle est dans l'année de rattachement, sinon le mois saisi si lui-même est dans l'année, sinon chaîne vide.
 */
export function monthKeyOfEntry(entry: HrPeriodFields): string {
  if (isPeriodNature(entry.nature)) {
    const period = validPeriod(entry.mois);
    if (period) return period;
  }
  const year = String(yearOfEntry(entry));
  const date = entry.date ?? "";
  if (date.slice(0, 4) === year) return date.slice(0, 7);
  return entry.mois.slice(0, 4) === year ? entry.mois : "";
}

/**
 * Date de l'agrégat mensuel du suivi : la dernière date de paiement du mois de rattachement `mk` ; si aucun paiement n'a eu lieu ce mois-là
 * (G50 de septembre payé en octobre), le dernier jour du mois `mk`, jamais une date d'un autre mois. Sans mois de rattachement (`mk` vide),
 * la dernière date de l'année `annee`, ou chaîne vide.
 */
export function aggregateDate(mk: string, annee: number, dates: readonly string[]): string {
  if (validPeriod(mk)) {
    const inMonth = dates.filter((date) => date.slice(0, 7) === mk).sort();
    const last = inMonth[inMonth.length - 1];
    if (last) return last;
    const lastDay = new Date(Date.UTC(Number(mk.slice(0, 4)), Number(mk.slice(5, 7)), 0)).getUTCDate();
    return `${mk}-${String(lastDay).padStart(2, "0")}`;
  }
  const inYear = dates.filter((date) => date.slice(0, 4) === String(annee)).sort();
  return inYear[inYear.length - 1] ?? "";
}
