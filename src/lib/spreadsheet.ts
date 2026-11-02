import ExcelJS from "exceljs";
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
  rows: Array<Array<string | number | Date | null>>;
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
    const worksheet = XLSX.utils.aoa_to_sheet(sheet.rows, { cellDates: true });
    for (const address of Object.keys(worksheet)) {
      if (address.startsWith("!")) continue;
      const cell = worksheet[address];
      if (cell && cell.t === "d") cell.z = "dd/mm/yyyy";
    }
    if (sheet.widths) worksheet["!cols"] = sheet.widths.map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(workbook, worksheet, sheet.name.slice(0, 31));
  }
  const output: ArrayBuffer = XLSX.write(workbook, { type: "array", bookType: "xlsx", cellDates: true });
  return new Uint8Array(output);
}

/** Ligne d'un état d'agence : cellules affichées et montant HT lu (null si illisible). */
export interface EtatsRowSpec {
  cells: Array<string | number | null>;
  amount: number | null;
}

/** État d'une agence : feuille, lignes et totaux. */
export interface EtatsAgencySpec {
  name: string;
  sheet: string;
  rows: EtatsRowSpec[];
  ht: number;
  tva: number;
  ttc: number;
}

/** Contenu d'un classeur d'états par agence (modèle imprimable A4 paysage avec logo et pied de page). */
export interface EtatsWorkbookSpec {
  titre: string;
  titreGeneral: string;
  /** Taux de TVA en fraction (0,19). */
  taux: number;
  columns: string[];
  htIndex: number;
  agencies: EtatsAgencySpec[];
  /** Mention « Établi par … » ; vide pour ne rien afficher. */
  who: string;
  /** Marges haute et basse en centimètres. */
  marginTop: number;
  marginBottom: number;
  /** Images PNG du logo et du pied de page ; null pour un état sans papier en-tête. */
  logo: { data: Uint8Array; ratio: number } | null;
  footer: { data: Uint8Array; ratio: number } | null;
  /** null : tous les états ; -1 : récapitulatif seul ; n : l'agence n seule. */
  only: number | null;
}

const ETATS_CM = 28.3464567;
const etatsPx = (width: number): number => Math.trunc(width * 7 + 5);
const etatsPts = (width: number): number => etatsPx(width) * 0.75;
const etatsCol = (n: number): string => {
  let out = "";
  let k = n;
  while (k > 0) {
    out = String.fromCharCode(65 + ((k - 1) % 26)) + out;
    k = Math.floor((k - 1) / 26);
  }
  return out;
};
const ETATS_THIN = { style: "thin" as const };
const ETATS_BORDER = { top: ETATS_THIN, left: ETATS_THIN, bottom: ETATS_THIN, right: ETATS_THIN };
const ETATS_MED = { style: "medium" as const };
const etatsFill = (argb: string): ExcelJS.Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb } });

interface EtatsCellStyle {
  font?: Partial<ExcelJS.Font>;
  border?: Partial<ExcelJS.Borders>;
  fill?: ExcelJS.Fill;
  alignment?: Partial<ExcelJS.Alignment>;
  numFmt?: string;
}

function etatsStyle(cell: ExcelJS.Cell, style: EtatsCellStyle): void {
  if (style.font) cell.font = style.font;
  if (style.border) cell.border = style.border;
  if (style.fill) cell.fill = style.fill;
  if (style.alignment) cell.alignment = style.alignment;
  if (style.numFmt) cell.numFmt = style.numFmt;
}

const etatsFont = (bold: boolean, size = 11): Partial<ExcelJS.Font> => ({ name: "Arial", size, bold });

/**
 * Écrit le classeur des états par agence : récapitulatif général puis une feuille par agence,
 * totaux en formules, mise en page A4 paysage centrée, logo en tête et pied de page Allo Assistance.
 */
export async function writeEtatsWorkbook(spec: EtatsWorkbookSpec): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const { taux, agencies } = spec;
  const pc = `${Number((taux * 100).toFixed(2))} %`;
  const logo = spec.logo;
  const footer = spec.footer;
  const hasLogo = Boolean(logo && footer);
  const marginSide = 1.2;
  const idLogo = logo && footer ? wb.addImage({ buffer: Buffer.from(logo.data) as unknown as ExcelJS.Buffer, extension: "png" }) : -1;
  const idFooter = logo && footer ? wb.addImage({ buffer: Buffer.from(footer.data) as unknown as ExcelJS.Buffer, extension: "png" }) : -1;

  function pageSetup(ws: ExcelJS.Worksheet, widths: number[], heights: number[], headRow: number, lastRow: number, lastCol: number): void {
    const zoneW = widths.reduce((sum, w) => sum + etatsPts(w), 0);
    const zoneH = heights.slice(hasLogo ? 0 : 2, lastRow).reduce((sum, h) => sum + h, 0);
    const fitW = Math.min(1, ((29.7 - 2 * marginSide) * ETATS_CM) / zoneW);
    const fitH = ((21 - spec.marginTop - spec.marginBottom) * ETATS_CM) / zoneH;
    const onePage = Math.min(fitW, fitH) >= 0.65;
    ws.pageSetup = {
      paperSize: 9,
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: onePage ? 1 : 0,
      horizontalCentered: true,
      margins: { left: marginSide / 2.54, right: marginSide / 2.54, top: spec.marginTop / 2.54, bottom: spec.marginBottom / 2.54, header: 0, footer: 0 },
      printArea: `B${hasLogo ? 1 : 3}:${etatsCol(lastCol)}${lastRow}`,
      printTitlesRow: `${headRow}:${headRow}`,
    };
  }

  function decorate(ws: ExcelJS.Worksheet, widths: number[], footerRow: number): void {
    if (!logo || !footer) return;
    ws.addImage(idLogo, { tl: { col: 1.05, row: 0.08 }, ext: { width: 80 * logo.ratio, height: 80 } });
    const totalW = widths.slice(1).reduce((sum, w) => sum + etatsPx(w), 0);
    const imageW = Math.min(520, totalW);
    const imageH = imageW / footer.ratio;
    let x = (totalW - imageW) / 2;
    let col = 1;
    while (col < widths.length - 1 && x > etatsPx(widths[col] ?? 0)) {
      x -= etatsPx(widths[col] ?? 0);
      col += 1;
    }
    ws.addImage(idFooter, { tl: { col: col + x / etatsPx(widths[col] ?? 1), row: footerRow + 0.1 }, ext: { width: imageW, height: imageH } });
  }

  function titleRow(ws: ExcelJS.Worksheet, lastCol: number, text: string, widthPts: number): void {
    ws.mergeCells(3, 2, 3, lastCol);
    const cell = ws.getCell(3, 2);
    cell.value = text;
    cell.font = etatsFont(true, 18);
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    ws.getRow(3).height = widthPts < 520 ? 56 : 36;
  }

  function totalsBox(ws: ExcelJS.Worksheet, row: number, labelCol: number, valueCol: number, values: Array<[string, ExcelJS.CellValue]>): void {
    values.forEach(([label, value], k) => {
      const last = k === 2;
      const style: EtatsCellStyle = {
        font: etatsFont(true, last ? 13 : 12),
        border: last ? { top: ETATS_MED, bottom: ETATS_MED, left: ETATS_MED, right: ETATS_MED } : ETATS_BORDER,
        fill: last ? etatsFill("FFFFF2CC") : undefined,
      };
      const labelCell = ws.getCell(row + k, labelCol);
      labelCell.value = label;
      etatsStyle(labelCell, { ...style, alignment: { horizontal: "center", vertical: "middle" } });
      const valueCell = ws.getCell(row + k, valueCol);
      valueCell.value = value;
      etatsStyle(valueCell, { ...style, numFmt: "#,##0.00", alignment: { horizontal: "right", vertical: "middle", indent: 1 } });
    });
  }

  const ncol = spec.columns.length;
  const position = agencies.map((a) => ({ agency: a, last: etatsCol(1 + ncol), total: 5 + a.rows.length + 2 }));

  // Récapitulatif général
  const wr = wb.addWorksheet("RÉCAPITULATIF GÉNÉRAL", { views: [{ showGridLines: false }] });
  const longest = Math.max(...agencies.map((a) => a.name.length));
  const widthsR = [2, 7, Math.min(48, Math.max(30, longest * 1.15 + 5)), 18, 20, 20, 20];
  widthsR.forEach((w, i) => {
    wr.getColumn(i + 1).width = w;
  });
  const lastList = 5 + agencies.length;
  const rowTotal = lastList + 1;
  const heightsR = [hasLogo ? 66 : 36, 8, 36, 12, 32, ...agencies.map(() => 24), 30, 16, 26, 26, 26, ...(hasLogo ? [16, 22, 22] : [])];
  heightsR.forEach((h, i) => {
    wr.getRow(i + 1).height = h;
  });
  titleRow(wr, 7, spec.titreGeneral, widthsR.slice(1).reduce((sum, w) => sum + etatsPts(w), 0));
  ["N°", "Agence", "Nombre de factures", "TOTAL HT", `TVA ${pc}`, "TOTAL TTC"].forEach((h, i) => {
    const cell = wr.getCell(5, 2 + i);
    cell.value = h;
    etatsStyle(cell, { font: etatsFont(true), border: ETATS_BORDER, alignment: { horizontal: "center", vertical: "middle", wrapText: true }, fill: etatsFill("FFD9E1F2") });
  });
  let totalN = 0;
  let totalHt = 0;
  let totalTva = 0;
  let totalTtc = 0;
  position.forEach(({ agency, last, total }, i) => {
    const row = 6 + i;
    const q = `'${agency.sheet.replace(/'/g, "''")}'`;
    const n = agency.rows.length;
    const values: ExcelJS.CellValue[] = [
      i + 1,
      agency.name,
      { formula: `ROWS(${q}!$B$6:$B$${5 + n})`, result: n },
      { formula: `${q}!$${last}$${total}`, result: agency.ht },
      { formula: `${q}!$${last}$${total + 1}`, result: agency.tva },
      { formula: `${q}!$${last}$${total + 2}`, result: agency.ttc },
    ];
    values.forEach((value, j) => {
      const cell = wr.getCell(row, 2 + j);
      cell.value = value;
      etatsStyle(cell, {
        font: etatsFont(false),
        border: ETATS_BORDER,
        alignment: { horizontal: j === 1 ? "left" : j > 2 ? "right" : "center", vertical: "middle", indent: j === 1 || j > 2 ? 1 : 0 },
        numFmt: j > 2 ? "#,##0.00" : j === 2 ? "#,##0" : "General",
      });
    });
    totalN += n;
    totalHt += agency.ht;
    totalTva += agency.tva;
    totalTtc += agency.ttc;
  });
  const grand: ExcelJS.CellValue[] = [
    null,
    "TOTAL GÉNÉRAL",
    { formula: `SUM(D6:D${lastList})`, result: totalN },
    { formula: `SUM(E6:E${lastList})`, result: totalHt },
    { formula: `SUM(F6:F${lastList})`, result: totalTva },
    { formula: `SUM(G6:G${lastList})`, result: totalTtc },
  ];
  grand.forEach((value, j) => {
    const cell = wr.getCell(rowTotal, 2 + j);
    cell.value = value;
    etatsStyle(cell, {
      font: etatsFont(true, 12),
      border: { top: ETATS_MED, bottom: ETATS_MED, left: ETATS_THIN, right: ETATS_THIN },
      fill: etatsFill("FFFFD966"),
      alignment: { horizontal: j === 1 ? "left" : j > 2 ? "right" : "center", vertical: "middle", indent: j === 1 || j > 2 ? 1 : 0 },
      numFmt: j > 2 ? "#,##0.00" : "#,##0",
    });
  });
  totalsBox(wr, rowTotal + 2, 6, 7, [
    ["TOTAL HT", { formula: `E${rowTotal}`, result: totalHt }],
    [`TVA ${pc}`, { formula: `F${rowTotal}`, result: totalTva }],
    ["TOTAL TTC", { formula: `G${rowTotal}`, result: totalTtc }],
  ]);
  if (spec.who) {
    const cell = wr.getCell(rowTotal + 4, 2);
    cell.value = spec.who;
    cell.font = { name: "Arial", size: 9, italic: true };
  }
  pageSetup(wr, widthsR.slice(1), heightsR, 5, rowTotal + 4 + (hasLogo ? 3 : 0), 7);
  decorate(wr, widthsR, rowTotal + 5);

  // Une feuille par agence
  for (const agency of agencies) {
    const ws = wb.addWorksheet(agency.sheet, { views: [{ showGridLines: false }] });
    const n = agency.rows.length;
    const lastRow = 5 + n;
    const rowTa = lastRow + 2;
    const lastCol = 1 + ncol;
    const textLength = (j: number): number => {
      const lengths = agency.rows.map((row) => (j === spec.htIndex ? (row.amount !== null ? row.amount.toLocaleString("fr-FR", { minimumFractionDigits: 2 }).length : String(row.cells[j] ?? "").length) : String(row.cells[j] ?? "").length));
      return Math.max((spec.columns[j] ?? "").length * 1.2, ...lengths);
    };
    const widths = [2, ...spec.columns.map((_, j) => Math.min(48, Math.max(11, textLength(j) * 1.1 + 5)))];
    widths[ncol - 1] = Math.max(widths[ncol - 1] ?? 0, 16);
    widths[ncol] = Math.max(widths[ncol] ?? 0, 18);
    widths.forEach((w, i) => {
      ws.getColumn(i + 1).width = w;
    });
    const totalW = widths.slice(1).reduce((sum, w) => sum + etatsPts(w), 0);
    const heights = [hasLogo ? 66 : 36, 8, 36, 12, 32, ...agency.rows.map(() => 24), 24, 26, 26, 26, ...(hasLogo ? [16, 22, 22] : [])];
    heights.forEach((h, i) => {
      ws.getRow(i + 1).height = h;
    });
    titleRow(ws, lastCol, spec.titre, totalW);
    spec.columns.forEach((name, j) => {
      const cell = ws.getCell(5, 2 + j);
      cell.value = name;
      etatsStyle(cell, { font: etatsFont(true), border: ETATS_BORDER, alignment: { horizontal: "center", vertical: "middle", wrapText: true }, fill: etatsFill("FFD9E1F2") });
    });
    agency.rows.forEach((row, i) => {
      spec.columns.forEach((_, j) => {
        const cell = ws.getCell(6 + i, 2 + j);
        const style: EtatsCellStyle = { font: etatsFont(false), border: ETATS_BORDER, alignment: { horizontal: "center", vertical: "middle" } };
        let value: string | number | null = row.cells[j] ?? null;
        if (j === spec.htIndex) {
          if (row.amount !== null) value = row.amount;
          else style.fill = etatsFill("FFFFC7CE");
          style.numFmt = "#,##0.00";
          style.alignment = { horizontal: "right", vertical: "middle", indent: 1 };
        }
        cell.value = value === "" ? null : value;
        etatsStyle(cell, style);
      });
    });
    const col = etatsCol(lastCol);
    totalsBox(ws, rowTa, lastCol - 1, lastCol, [
      ["TOTAL HT", { formula: `SUM(${col}6:${col}${lastRow})`, result: agency.ht }],
      [`TVA ${pc}`, { formula: `ROUND(${col}${rowTa}*${taux},2)`, result: agency.tva }],
      ["TOTAL TTC", { formula: `${col}${rowTa}+${col}${rowTa + 1}`, result: agency.ttc }],
    ]);
    if (spec.who) {
      const cell = ws.getCell(rowTa + 2, 2);
      cell.value = spec.who;
      cell.font = { name: "Arial", size: 9, italic: true };
    }
    pageSetup(ws, widths.slice(1), heights, 5, rowTa + 2 + (hasLogo ? 3 : 0), lastCol);
    decorate(ws, widths, rowTa + 3);
  }

  // Un seul état : on retire les autres feuilles ; le récapitulatif garde ses valeurs (plus de formules vers d'autres feuilles).
  if (spec.only !== null) {
    const keep = spec.only < 0 ? "RÉCAPITULATIF GÉNÉRAL" : (agencies[spec.only]?.sheet ?? "RÉCAPITULATIF GÉNÉRAL");
    if (spec.only < 0) {
      wr.eachRow((row) =>
        row.eachCell((cell) => {
          const value = cell.value;
          if (value && typeof value === "object" && "formula" in value) cell.value = (value as ExcelJS.CellFormulaValue).result as ExcelJS.CellValue;
        }),
      );
    }
    for (const sheet of [...wb.worksheets]) if (sheet.name !== keep) wb.removeWorksheet(sheet.id);
  }
  const buffer = await wb.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}
