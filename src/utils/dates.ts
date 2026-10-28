/** Convertit une date SQL (`DATE`, minuit UTC) en `AAAA-MM-JJ`. */
export function toIsoDate(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

/** Convertit `AAAA-MM-JJ` en objet Date à minuit UTC ; `null` si vide ou invalide. */
export function fromIsoDate(value: string | null | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Date du jour au format `AAAA-MM-JJ` (fuseau d'Alger). */
export function todayIso(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Algiers" }).format(new Date());
}

/** Nombre de jours entiers entre deux dates `AAAA-MM-JJ`. */
export function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso}T00:00:00Z`);
  const to = Date.parse(`${toIso}T00:00:00Z`);
  return Math.floor((to - from) / 86_400_000);
}

/** Écart absolu en jours entre deux dates `AAAA-MM-JJ`. */
export function dayGap(a: string, b: string): number {
  return Math.abs(daysBetween(a, b));
}

/** Décale une date `AAAA-MM-JJ` de `days` jours. */
export function shiftIsoDate(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Lit une date de relevé ou de fichier Excel : objet Date, numéro de série Excel, « JJ/MM/AAAA », « JJ-MM-AA » ou ISO.
 * Renvoie `AAAA-MM-JJ`, ou une chaîne vide si la valeur n'est pas une date.
 */
export function parseLooseDate(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    // Les dates Excel sont lues à minuit local : on prend les composantes locales puis on corrige l'arrondi éventuel.
    const shifted = new Date(value.getTime() + 12 * 3600 * 1000);
    return shifted.toISOString().slice(0, 10);
  }
  if (typeof value === "number" && value > 20000 && value < 80000) {
    const date = new Date(Math.round((value - 25569) * 86_400_000));
    return date.toISOString().slice(0, 10);
  }
  const text = String(value ?? "").trim();
  let match = text.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (match) {
    const [, day = "", month = "", yearRaw = ""] = match;
    const year = yearRaw.length === 2 ? `20${yearRaw}` : yearRaw;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? match[0] : "";
}

/** Noms des mois en français. */
export const MONTHS_FR = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"] as const;
