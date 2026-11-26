import { upperPlain } from "@/utils/text";

const MONTH_PREFIXES: ReadonlyArray<[string, number]> = [["JANV", 1], ["JAN", 1], ["FEV", 2], ["MARS", 3], ["AVR", 4], ["MAI", 5], ["JUIN", 6], ["JUIL", 7], ["AOUT", 8], ["SEPT", 9], ["OCT", 10], ["NOV", 11], ["DEC", 12]];
/** Libellés qui ne sont pas une avance mensuelle (régularisations, refacturations, trimestres…). */
export const NOT_MONTHLY = /REGUL|REFACTUR|TRIMESTR|PASSI[FV]|DIRECTION|ANNEXE|LISTE JOINTE/;

/** Mois de production (« AAAA-MM ») d'une facture : champ « période », sinon cité dans le libellé (« AOUT2026 », « Juillet 2026 »…). */
export function productionPeriod(periode: string, libelle: string): string | null {
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(periode)) return periode;
  const text = upperPlain(libelle);
  const named = text.match(/(JANV\w*|JAN|FEV\w*|MARS|AVR\w*|MAI|JUIN|JUIL\w*|AOUT|SEPT\w*|OCT\w*|NOV\w*|DEC\w*)\s*[-/ ]*\s*(20\d\d)/);
  if (named?.[1] && named[2]) {
    const month = MONTH_PREFIXES.find(([prefix]) => named[1]?.startsWith(prefix))?.[1];
    if (month) return `${named[2]}-${String(month).padStart(2, "0")}`;
  }
  const numeric = text.match(/\b(0?[1-9]|1[0-2])\s*\/\s*(20\d\d)\b/);
  return numeric?.[1] && numeric[2] ? `${numeric[2]}-${numeric[1].padStart(2, "0")}` : null;
}
