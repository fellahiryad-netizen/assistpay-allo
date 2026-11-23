/**
 * Nettoyage des textes saisis ou repris d'un fichier Excel : espaces insécables et caractères invisibles remplacés,
 * espaces multiples réduits, espace avant une apostrophe supprimée. Ne change ni les mots ni la casse.
 */
export function cleanText(value: string): string {
  return value
    .replace(/[\p{Zs}\t\r\n]+/gu, " ")
    .replace(/\p{Cf}/gu, "")
    .replace(/(\p{L}) '(?=\p{L})/gu, "$1'")
    .replace(/ {2,}/g, " ")
    .trim();
}

/** Nettoie un ou plusieurs numéros : retire le préfixe « TEL : » et une barre oblique finale. */
export function cleanPhones(value: string): string {
  return cleanText(value)
    .replace(/^t[ée]l(?:[ée]phone)?\.?\s*:?\s*/i, "")
    .replace(/\s*\/\s*$/, "")
    .trim();
}

/** Nettoie un nom de personne : « M.LAYADA » devient « M. LAYADA ». */
export function cleanPersonName(value: string): string {
  return cleanText(value).replace(/\b(M|Mr|Mme|Mlle)\.(?=\p{L})/gu, "$1. ");
}

/** Lien `tel:` du premier numéro d'un texte (chiffres et « + » seulement) ; chaîne vide s'il n'y a pas assez de chiffres. */
export function telHref(value: string): string {
  const first = cleanText(value).split(/[/;,]/)[0] ?? "";
  const digits = first.replace(/[^\d+]/g, "");
  return digits.replace(/\D/g, "").length >= 6 ? `tel:${digits}` : "";
}
