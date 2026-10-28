const amountFormatter = new Intl.NumberFormat("fr-DZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const compactFormatter = new Intl.NumberFormat("fr-DZ", { notation: "compact", maximumFractionDigits: 1 });
const dateFormatter = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
const dateTimeFormatter = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Africa/Algiers",
});

/** Montant en dinars : « 1 234 567,89 DA ». */
export function formatDA(value: number): string {
  return `${amountFormatter.format(value)} DA`;
}

/** Montant abrégé pour les indicateurs : « 12,3 M ». */
export function formatCompact(value: number): string {
  return compactFormatter.format(value);
}

/** Date `AAAA-MM-JJ` → « JJ/MM/AAAA » ; chaîne vide si absente. */
export function formatDate(isoDate: string | null): string {
  if (!isoDate) return "";
  const date = new Date(`${isoDate}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? "" : dateFormatter.format(date);
}

/** Horodatage ISO → « JJ/MM/AAAA HH:MM » (heure d'Alger). */
export function formatDateTime(isoDateTime: string): string {
  const date = new Date(isoDateTime);
  return Number.isNaN(date.getTime()) ? "" : dateTimeFormatter.format(date);
}
