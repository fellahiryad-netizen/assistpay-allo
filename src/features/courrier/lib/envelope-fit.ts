/** Largeurs (millièmes d'em) de Helvetica / Arial gras pour les caractères d'une étiquette en majuscules ; Liberation Sans gras a les mêmes. */
const BOLD_WIDTHS: Readonly<Record<string, number>> = {
  " ": 278, "!": 333, '"': 474, "#": 556, $: 556, "%": 889, "&": 722, "'": 238, "(": 333, ")": 333, "*": 389, "+": 584, ",": 278, "-": 333, ".": 278, "/": 278,
  "0": 556, "1": 556, "2": 556, "3": 556, "4": 556, "5": 556, "6": 556, "7": 556, "8": 556, "9": 556,
  ":": 333, ";": 333, "<": 584, "=": 584, ">": 584, "?": 611, "@": 975,
  A: 722, B: 722, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 556, K: 722, L: 611, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  "[": 333, "]": 333, _: 556, "–": 556, "—": 1000, "°": 400, "’": 278, "«": 556, "»": 556,
};

/** Largeur d'un caractère inconnu : celle d'un grand « M » moins un peu, par prudence. */
const FALLBACK_WIDTH = 800;

/** Marge de sécurité sur la largeur mesurée (4 %) : mieux vaut une lettre un peu plus petite qu'une ligne qui déborde. */
const SAFETY = 1.04;

/** Millimètres par point typographique. */
export const MM_PER_PT = 25.4 / 72;

/** Largeur d'un texte en em (gras, majuscules, accents ignorés pour la mesure). */
export function textWidthEm(text: string): number {
  const plain = text.normalize("NFD").replace(/\p{M}/gu, "").toLocaleUpperCase("fr");
  let total = 0;
  for (const char of plain) total += BOLD_WIDTHS[char] ?? FALLBACK_WIDTH;
  return (total / 1000) * SAFETY;
}

/** Réglage demandé pour une ligne ou un bloc de texte de l'étiquette. */
export interface FitInput {
  text: string;
  /** Largeur disponible, en millimètres. */
  widthMm: number;
  /** Taille maximale, en points : la taille choisie ne la dépasse jamais. */
  maxPt: number;
  /** Taille minimale, en points : en dessous, on accepte plus de lignes plutôt que des lettres illisibles. */
  minPt: number;
  /** Nombre de lignes souhaité au plus. */
  maxLines: number;
}

/** Texte découpé en lignes et taille de police retenue. */
export interface FitResult {
  fontPt: number;
  /** Lignes, en majuscules, à afficher l'une sous l'autre. */
  lines: string[];
}

/** Découpage glouton en lignes de largeur au plus `limitEm`. Un mot trop long reste seul sur sa ligne. */
function greedyLines(words: readonly string[], limitEm: number): string[][] {
  const lines: string[][] = [];
  let current: string[] = [];
  for (const word of words) {
    const candidate = [...current, word];
    if (current.length > 0 && textWidthEm(candidate.join(" ")) > limitEm) {
      lines.push(current);
      current = [word];
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) lines.push(current);
  return lines;
}

/** Découpe en exactement `count` lignes en minimisant la ligne la plus large (lignes équilibrées, plus lisibles). */
function balancedLines(words: readonly string[], count: number): string[][] {
  const n = words.length;
  if (count <= 1 || n <= count) return count <= 1 ? [[...words]] : words.map((word) => [word]);
  const width = (from: number, to: number): number => textWidthEm(words.slice(from, to).join(" "));
  // best[k][i] : plus petite « plus grande largeur » pour répartir les i premiers mots en k lignes.
  const best: number[][] = Array.from({ length: count + 1 }, () => Array<number>(n + 1).fill(Infinity));
  const cut: number[][] = Array.from({ length: count + 1 }, () => Array<number>(n + 1).fill(0));
  best[0]![0] = 0;
  for (let k = 1; k <= count; k += 1) {
    for (let i = k; i <= n; i += 1) {
      for (let j = k - 1; j < i; j += 1) {
        const cost = Math.max(best[k - 1]![j]!, width(j, i));
        if (cost < best[k]![i]!) {
          best[k]![i] = cost;
          cut[k]![i] = j;
        }
      }
    }
  }
  const lines: string[][] = [];
  let end = n;
  for (let k = count; k >= 1; k -= 1) {
    const start = cut[k]![end]!;
    lines.unshift(words.slice(start, end) as string[]);
    end = start;
  }
  return lines;
}

/**
 * Taille de police la plus grande (entre `maxPt` et `minPt`, par pas de 1 pt) qui permet d'écrire le texte en `maxLines` lignes au plus
 * dans la largeur disponible, sans jamais couper un mot. Les lignes sont équilibrées. Si même la taille minimale ne suffit pas,
 * la taille minimale est gardée avec autant de lignes que nécessaire (rien n'est coupé ni tronqué). Fonction pure.
 */
export function fitEnvelopeText(input: FitInput): FitResult {
  const words = input.text.split(/\s+/).filter((word) => word.length > 0).map((word) => word.toLocaleUpperCase("fr"));
  const maxPt = Math.max(input.maxPt, input.minPt);
  if (words.length === 0) return { fontPt: maxPt, lines: [] };
  const lineLimit = Math.max(1, input.maxLines);
  const render = (list: string[][]): string[] => list.map((line) => line.join(" "));
  for (let pt = Math.floor(maxPt); pt >= input.minPt; pt -= 1) {
    const limitEm = input.widthMm / (pt * MM_PER_PT);
    const greedy = greedyLines(words, limitEm);
    if (greedy.length <= lineLimit && greedy.every((line) => textWidthEm(line.join(" ")) <= limitEm)) {
      return { fontPt: pt, lines: render(balancedLines(words, greedy.length)) };
    }
  }
  const limitEm = input.widthMm / (input.minPt * MM_PER_PT);
  return { fontPt: input.minPt, lines: render(greedyLines(words, limitEm)) };
}

/** Largeur utile du texte sur l'étiquette A4 paysage, en millimètres (feuille 285 mm, cadre, marges et réserve de sécurité déduits). */
export const ENVELOPE_TEXT_WIDTH_MM = 262;

/** Champs de la fiche utiles à l'étiquette. */
export interface EnvelopeSource {
  nom: string;
  contact: string;
  telephones: string;
  adresse: string;
}

/** Mise en page complète d'une étiquette : une taille et des lignes pour chaque bloc. */
export interface EnvelopeLayout {
  nom: FitResult;
  adresse: FitResult;
  telephones: FitResult;
  /** Ligne « À l'attention de … », absente si la fiche n'a pas de contact. */
  contact: FitResult | null;
}

/**
 * Taille d'adresse : on cherche d'abord à tenir sur une ou deux lignes (jusqu'à 72 pt, au moins 34 pt) ;
 * si l'adresse est trop longue, on accepte trois lignes plus petites (au moins 30 pt) plutôt que de la couper.
 */
export function fitAddress(text: string, widthMm: number = ENVELOPE_TEXT_WIDTH_MM): FitResult {
  const two = fitEnvelopeText({ text, widthMm, maxPt: 72, minPt: 34, maxLines: 2 });
  if (two.lines.length <= 2) return two;
  return fitEnvelopeText({ text, widthMm, maxPt: 72, minPt: 30, maxLines: 3 });
}

/** Une seule ligne si elle reste lisible (au moins `oneLineMinPt`), sinon deux lignes jusqu'à `minPt`. */
function fitOneLineFirst(text: string, widthMm: number, maxPt: number, oneLineMinPt: number, minPt: number): FitResult {
  const one = fitEnvelopeText({ text, widthMm, maxPt, minPt: oneLineMinPt, maxLines: 1 });
  if (one.lines.length <= 1) return one;
  return fitEnvelopeText({ text, widthMm, maxPt, minPt, maxLines: 2 });
}

/** Calcule la taille et les lignes de chaque bloc de l'étiquette (nom 48 pt, adresse 72 pt, téléphone 48 pt au plus ; réduction automatique). */
export function layoutEnvelope(source: EnvelopeSource, widthMm: number = ENVELOPE_TEXT_WIDTH_MM): EnvelopeLayout {
  return {
    nom: fitOneLineFirst(source.nom, widthMm, 48, 36, 24),
    adresse: fitAddress(source.adresse, widthMm),
    telephones: fitOneLineFirst(source.telephones, widthMm, 48, 32, 24),
    contact: source.contact ? fitEnvelopeText({ text: `À l'attention de ${source.contact}`, widthMm, maxPt: 30, minPt: 18, maxLines: 1 }) : null,
  };
}

/** Interligne des blocs de l'étiquette (identique à la feuille de style). */
const LINE_HEIGHT = 1.05;

/** Espace entre deux blocs de texte, en millimètres (identique à la feuille de style d'une étiquette avec repère de compagnie). */
const BLOCK_GAP_MM = 2.5;

/** Hauteur occupée par les blocs d'une mise en page, en millimètres. */
export function layoutHeightMm(layout: EnvelopeLayout): number {
  const blocks = [layout.nom, layout.adresse, ...(layout.telephones.lines.length > 0 ? [layout.telephones] : []), ...(layout.contact ? [layout.contact] : [])];
  return blocks.reduce((sum, block) => sum + block.lines.length * block.fontPt * LINE_HEIGHT * MM_PER_PT, 0) + BLOCK_GAP_MM * Math.max(0, blocks.length - 1);
}

/**
 * Réduit toutes les tailles dans la même proportion si la mise en page dépasse la hauteur disponible (étiquette avec repère de compagnie, qui prend de la place en haut).
 * Une mise en page qui tient déjà est rendue telle quelle ; les lignes restent les mêmes (une taille plus petite ne peut pas ajouter de ligne).
 */
export function shrinkLayoutToHeight(layout: EnvelopeLayout, availableMm: number): EnvelopeLayout {
  const needed = layoutHeightMm(layout);
  if (needed <= availableMm) return layout;
  const factor = Math.max(0.4, availableMm / needed);
  const scale = (block: FitResult): FitResult => ({ ...block, fontPt: Math.max(12, Math.floor(block.fontPt * factor * 2) / 2) });
  return { nom: scale(layout.nom), adresse: scale(layout.adresse), telephones: scale(layout.telephones), contact: layout.contact ? scale(layout.contact) : null };
}
