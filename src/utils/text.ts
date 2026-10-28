/** Normalise un texte pour la recherche : minuscules, sans accents, espaces réduits. */
export function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Majuscules sans accents (comparaisons de libellés bancaires, noms de prestataires). */
export function upperPlain(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
}

/** Garde seulement lettres et chiffres, en majuscules. */
export function alnumKey(value: string): string {
  return upperPlain(value).replace(/[^A-Z0-9]/g, "");
}

const NAME_STOP = new Set(["EURL", "SARL", "SNC", "ETS", "SPA", "STE", "EI", "ET", "DE", "DU", "EL", "LA", "LE", "SOCIETE", "ENTREPRISE"]);

/** Mots significatifs d'un nom (sans formes juridiques ni articles). */
export function nameTokens(value: string): string[] {
  return upperPlain(value)
    .replace(/[^A-Z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1 && !NAME_STOP.has(token));
}

/** Similarité de deux noms : part des mots du nom le plus court retrouvés dans l'autre (0 à 1). */
export function nameSimilarity(a: string, b: string): number {
  const left = new Set(nameTokens(a));
  const right = new Set(nameTokens(b));
  if (left.size === 0 || right.size === 0) return 0;
  let common = 0;
  left.forEach((token) => {
    if (right.has(token)) common += 1;
  });
  return common / Math.min(left.size, right.size);
}

/** Même bénéficiaire probable (règle reprise de l'ancienne version : inclusion, préfixe ou deux mots communs). */
export function sameBeneficiary(a: string, b: string): boolean {
  const clean = (text: string): string =>
    upperPlain(text)
      .replace(/\b(SARL|EURL|SPA|SNC|ETS|EI|MI SOFT)\b/g, " ")
      .replace(/\(.*?\)/g, " ")
      .replace(/[^A-Z ]/g, " ")
      .trim();
  const left = clean(a);
  const right = clean(b);
  const x = left.replace(/ /g, "");
  const y = right.replace(/ /g, "");
  if (x.length < 4 || y.length < 4) return false;
  if (x === y || x.includes(y) || y.includes(x) || x.slice(0, 10) === y.slice(0, 10)) return true;
  const wordsA = left.split(/\s+/).filter((word) => word.length >= 4);
  const wordsB = right.split(/\s+/).filter((word) => word.length >= 4);
  const firstA = wordsA[0];
  if (firstA && firstA === wordsB[0] && firstA.length >= 5) return true;
  return wordsA.filter((word) => wordsB.includes(word)).length >= 2;
}
