import * as XLSX from "xlsx";

/** Cellule lue dans un classeur : texte, nombre, booléen, date ou vide. */
export type SheetCell = string | number | boolean | Date | null;

/** Feuille lue : nom et lignes (tableau de cellules). */
export interface SheetData {
  name: string;
  rows: SheetCell[][];
}

/** Feuille à écrire. */
export interface SheetToWrite {
  name: string;
  rows: Array<Array<string | number | null>>;
  /** Largeur des colonnes en caractères. */
  widths?: number[];
}

function toCell(value: unknown): SheetCell {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value;
  return String(value);
}

/**
 * Lit toutes les feuilles d'un fichier Excel (.xlsx, .xls) ou CSV.
 * Les lignes sont alignées sur A1 : `rows[0][0]` est toujours la cellule A1, même si la feuille commence plus loin.
 * Adaptateur d'infrastructure : les services reçoivent des lignes déjà lues.
 */
export function readWorkbook(bytes: Uint8Array): SheetData[] {
  const workbook = XLSX.read(bytes, { type: "array", cellDates: true });
  return workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name];
    if (!sheet || !sheet["!ref"]) return { name, rows: [] };
    const range = XLSX.utils.decode_range(sheet["!ref"]);
    const raw: unknown[][] = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null, blankrows: true });
    const pad: SheetCell[] = Array.from({ length: range.s.c }, () => null);
    const rows: SheetCell[][] = Array.from({ length: range.s.r }, () => []);
    for (const row of raw) rows.push([...pad, ...row.map(toCell)]);
    return { name, rows };
  });
}

/** Valeur d'une cellule par son adresse (« E4 ») dans des lignes alignées sur A1. */
export function cellAt(rows: SheetCell[][], address: string): SheetCell {
  const { r, c } = XLSX.utils.decode_cell(address);
  return rows[r]?.[c] ?? null;
}

/** Écrit un classeur .xlsx et renvoie son contenu binaire. */
export function writeWorkbook(sheets: SheetToWrite[]): Uint8Array {
  const workbook = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const worksheet = XLSX.utils.aoa_to_sheet(sheet.rows);
    if (sheet.widths) worksheet["!cols"] = sheet.widths.map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(workbook, worksheet, sheet.name.slice(0, 31));
  }
  const output: ArrayBuffer = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
  return new Uint8Array(output);
}
