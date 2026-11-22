/**
 * Prépare un texte pour les polices standard du PDF (jeu latin-1/WinAnsi) : espaces insécables et fines remplacés par une espace,
 * tirets longs, guillemets droits et flèches ramenés à des signes simples, tout caractère hors jeu remplacé par « ? ».
 */
export function pdfText(value: unknown): string {
  return String(value ?? "")
    .replace(/[    ]/g, " ")
    .replace(/[−–—]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/→/g, "->")
    .replace(/…/g, "...")
    .replace(/œ/g, "oe")
    .replace(/Œ/g, "OE")
    .replace(/[^\x00-\xFF]/g, "?");
}
