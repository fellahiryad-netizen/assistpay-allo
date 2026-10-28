import { cellAt, type SheetCell, type SheetData } from "@/lib/spreadsheet";
import type { DpProduct, ImportedRequest } from "@/features/payment-requests/types";
import { parseLooseAmount, round2 } from "@/utils/amounts";
import { upperPlain } from "@/utils/text";

const COLUMNS = "ABCDEFGHIJKL";
const NAME_LABEL = /NOM\s*(ET|&|\/)?\s*PR[EÉ]NOM|B[EÉ]N[EÉ]FICIAIRE|RAISON\s+SOCIALE|AU\s+PROFIT\s+DE/i;
const PRODUCT_LABELS: ReadonlyArray<[DpProduct, RegExp]> = [
  ["Assistance routière", /ASSISTANCE\s*ROUTI|D[EÉ]PANNAGE|REMORQU/i],
  ["BDG", /\bBDG\b|BRIS\s+DE\s+GLACE/i],
  ["Tiers payant", /TIERS\s*PAYANT|\bTPA\b/i],
  ["Autre", /^\s*AUTRES?\b/i],
];

function text(cell: SheetCell): string {
  if (cell === null || cell === undefined) return "";
  if (cell instanceof Date) return cell.toISOString().slice(0, 10);
  return String(cell).replace(/\s+/g, " ").trim();
}

const isTicked = (cell: SheetCell): boolean => /^(X|✓|✔|√|■|☒|☑|●|•|1|OUI|V)$/i.test(text(cell));

/** Nom et prénom du bénéficiaire : cellule D10 du modèle, sinon la valeur à droite de l'étiquette. */
function beneficiaryOf(rows: SheetCell[][]): string {
  const direct = text(cellAt(rows, "D10"));
  if (direct && !NAME_LABEL.test(direct) && !/^:+$/.test(direct)) return direct.replace(/^:\s*/, "");
  for (let row = 5; row <= 22; row += 1) {
    for (let col = 0; col < COLUMNS.length; col += 1) {
      const value = text(cellAt(rows, `${COLUMNS[col]}${row}`));
      if (!NAME_LABEL.test(value)) continue;
      const after = value.split(/[:：]/).slice(1).join(":").trim();
      if (after && !NAME_LABEL.test(after)) return after;
      for (let next = col + 1; next < COLUMNS.length; next += 1) {
        const candidate = text(cellAt(rows, `${COLUMNS[next]}${row}`));
        if (candidate && !/^:+$/.test(candidate) && !NAME_LABEL.test(candidate)) return candidate.replace(/^:\s*/, "");
      }
    }
  }
  return direct;
}

/** Produit coché dans les cases du bas (F30 assistance, F32 BDG, H30 tiers payant, H32 autre), ou à côté de son libellé. */
function productOf(rows: SheetCell[][]): DpProduct | "" {
  if (isTicked(cellAt(rows, "F30"))) return "Assistance routière";
  if (isTicked(cellAt(rows, "F32"))) return "BDG";
  if (isTicked(cellAt(rows, "H30"))) return "Tiers payant";
  if (isTicked(cellAt(rows, "H32"))) return "Autre";
  for (let row = 26; row <= 38; row += 1) {
    for (let col = 0; col < COLUMNS.length; col += 1) {
      const value = text(cellAt(rows, `${COLUMNS[col]}${row}`));
      const product = PRODUCT_LABELS.find(([, pattern]) => pattern.test(value));
      if (!product) continue;
      for (const neighbour of [col + 1, col + 2, col - 1]) {
        if (neighbour >= 0 && neighbour < COLUMNS.length && isTicked(cellAt(rows, `${COLUMNS[neighbour]}${row}`))) return product[0];
      }
    }
  }
  return "";
}

/** Clé de comparaison d'un nom de prestataire. */
export function beneficiaryKey(name: string): string {
  return upperPlain(name).replace(/[^A-Z0-9]+/g, " ").trim();
}

/** Produit déduit de la catégorie d'une facture. */
export function productFromCategory(categorie: string): DpProduct | "" {
  if (/BDG/i.test(categorie)) return "BDG";
  if (/TPA|TIERS/i.test(categorie)) return "Tiers payant";
  if (/ASSIST|ROUTI/i.test(categorie)) return "Assistance routière";
  if (/REMBOURS|FOURNISS/i.test(categorie)) return "Autre";
  return "";
}

/**
 * Lit un classeur de demandes de paiement : une feuille par demande (modèle EURL ALLO ASSISTANCE).
 * Les feuilles « SAISIE » sont ignorées. Le produit non coché est déduit de l'historique du prestataire.
 */
export function parseRequestWorkbook(sheets: SheetData[], guessProduct: (beneficiaire: string) => DpProduct | ""): ImportedRequest[] {
  const out: ImportedRequest[] = [];
  for (const sheet of sheets) {
    if (/SAISIE/i.test(sheet.name)) continue;
    const rows = sheet.rows;
    const ref = text(cellAt(rows, "E4"));
    const numMatch = ref.match(/^(\d+)/);
    if (!numMatch?.[1]) continue;
    const pieces: string[] = [];
    for (let row = 37; row <= 47; row += 1) {
      const value = text(cellAt(rows, `A${row}`));
      if (value) pieces.push(value);
    }
    const nature: string[] = [];
    for (let row = 23; row <= 26; row += 1) {
      const value = text(cellAt(rows, `A${row}`));
      if (value) nature.push(value);
    }
    const factures = pieces.flatMap((piece) => {
      const match = piece.match(/N\s*°?\s*:?\s*(\S.*?)\s+(?:du|DU)\s+(\d{2}\/\d{2}\/\d{4})/);
      return match?.[1] && match[2] ? [{ n: match[1], d: match[2].split("/").reverse().join("-") }] : [];
    });
    const beneficiaire = beneficiaryOf(rows);
    let produit = productOf(rows);
    let produitDeduit = false;
    if (!produit) {
      produit = guessProduct(beneficiaire);
      produitDeduit = produit !== "";
    }
    const amount = parseLooseAmount(cellAt(rows, "F16"));
    out.push({
      num: Number(numMatch[1]),
      ref,
      beneficiaire,
      adresse: text(cellAt(rows, "D13")),
      montant: Number.isFinite(amount) ? round2(amount) : 0,
      nature: nature.join(" / ") || "Règlement de facture prestataire",
      mode: isTicked(cellAt(rows, "B30")) ? "VIRMT" : isTicked(cellAt(rows, "B32")) ? "CHEQUE" : "",
      produit,
      produitDeduit,
      pieces,
      factures,
    });
  }
  return out;
}
