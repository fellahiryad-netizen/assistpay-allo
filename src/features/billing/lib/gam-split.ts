import type { SheetCell } from "@/lib/spreadsheet";
import { fail, ok, type ActionResult } from "@/types";
import { parseLooseAmount, round2 } from "@/utils/amounts";

/** Dossier BDG GAM d'un fichier du système (prix HT en DA). */
export interface GamLine {
  dos: string;
  mat: string;
  nom: string;
  ag: string;
  /** Colonne « Produit » du fichier (pare-brise, lunette arrière…). */
  pres: string;
  dt: string;
  /** Numéro de sinistre normalisé (chiffres seulement pour le Takaful). */
  sin: string;
  prix: number;
  /** Numéro de ligne dans la feuille (à partir de 1). */
  row: number;
}

/** Ligne qui n'a pas pu être classée (ni conventionnelle, ni Takaful). */
export interface GamUnknown {
  row: number;
  dos: string;
  sin: string;
  reason: string;
}

/** Fichier GAM séparé en conventionnel et Takaful, avec les contrôles. */
export interface GamSplit {
  conv: GamLine[];
  takaful: GamLine[];
  unknown: GamUnknown[];
  duplicates: Array<{ dos: string; rows: number[] }>;
  fileNum: string;
  fileDate: string;
  fileTotalHt: number | null;
  convHt: number;
  takafulHt: number;
  totalHt: number;
  controlOk: boolean;
}

const norm = (value: SheetCell): string =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[\s  ]+/g, "")
    .toLowerCase();

const text = (value: SheetCell): string => {
  if (value instanceof Date) return `${String(value.getDate()).padStart(2, "0")}/${String(value.getMonth() + 1).padStart(2, "0")}/${value.getFullYear()}`;
  return String(value ?? "").replace(/[  ]/g, " ").trim();
};

const COLUMNS: Record<"dos" | "mat" | "nom" | "ag" | "pres" | "dt" | "sin" | "prix", string[]> = {
  dos: ["n°dossier", "ndossier", "dossier"],
  mat: ["matricule"],
  nom: ["nomclient", "client"],
  ag: ["agence"],
  pres: ["produit"],
  dt: ["date"],
  sin: ["n°sinistre", "nsinistre", "sinistre"],
  prix: ["prix", "prixht", "montantht"],
};

/**
 * Sépare l'extraction du système (« bill-… ») en dossiers conventionnels (sinistre à 10 chiffres)
 * et Takaful (sinistre dont les chiffres font 12). Lecture seule : aucune règle de facturation n'est touchée.
 * `rows` : première feuille lue par `readWorkbook` (lignes alignées sur A1).
 */
export function splitGamFile(rows: SheetCell[][]): ActionResult<GamSplit> {
  const headerIndex = rows.findIndex((row) => {
    const labels = row.map(norm);
    return labels.some((label) => COLUMNS.dos.includes(label)) && labels.some((label) => COLUMNS.sin.includes(label));
  });
  if (headerIndex < 0) return fail("En-tête introuvable : le fichier doit contenir les colonnes « N°Dossier » et « N° sinistre ».", "VALIDATION");
  const header = (rows[headerIndex] ?? []).map(norm);
  const col = {} as Record<keyof typeof COLUMNS, number>;
  for (const key of Object.keys(COLUMNS) as Array<keyof typeof COLUMNS>) col[key] = header.findIndex((label) => COLUMNS[key].includes(label));
  const missing = (["dos", "sin", "prix"] as const).filter((key) => col[key] < 0);
  if (missing.length) return fail("Colonnes manquantes dans le fichier : N°Dossier, N° sinistre et Prix sont obligatoires.", "VALIDATION");

  let fileNum = "";
  let fileDate = "";
  for (const row of rows.slice(0, headerIndex)) {
    for (const cell of row) {
      const value = text(cell);
      const num = /^N°\s*:\s*(.+)$/i.exec(value);
      if (num?.[1] && !fileNum) fileNum = num[1].trim();
      const date = /^Date\s*:\s*(.+)$/i.exec(value);
      if (date?.[1] && !fileDate) fileDate = date[1].trim();
    }
  }

  const conv: GamLine[] = [];
  const takaful: GamLine[] = [];
  const unknown: GamUnknown[] = [];
  const seen = new Map<string, number[]>();
  let fileTotalHt: number | null = null;
  const cell = (row: SheetCell[], index: number): string => (index >= 0 ? text(row[index] ?? null) : "");

  const totalOf = (row: SheetCell[]): number | null | undefined => {
    const totalAt = row.findIndex((value) => norm(value) === "totalht");
    if (totalAt < 0) return undefined;
    const next = row.slice(totalAt + 1).find((value) => value !== null && text(value) !== "");
    const amount = parseLooseAmount(next ?? "");
    return Number.isFinite(amount) ? round2(amount) : null;
  };

  for (let index = headerIndex + 1; index < rows.length; index += 1) {
    const row = rows[index] ?? [];
    const dos = cell(row, col.dos);
    const total = totalOf(row);
    if (total !== undefined || !dos) {
      // Fin du tableau : le « Total HT » suit parfois une ligne vide.
      for (const rest of total !== undefined ? [row] : rows.slice(index)) {
        const found = totalOf(rest);
        if (found !== undefined) {
          fileTotalHt = found;
          break;
        }
      }
      break;
    }
    const rowNumber = index + 1;
    const sinRaw = cell(row, col.sin);
    const digits = sinRaw.replace(/\D/g, "");
    const rawPrice = parseLooseAmount(row[col.prix] ?? "");
    seen.set(dos, [...(seen.get(dos) ?? []), rowNumber]);
    if (!Number.isFinite(rawPrice)) {
      unknown.push({ row: rowNumber, dos, sin: sinRaw, reason: "Prix illisible." });
      continue;
    }
    const line: GamLine = { dos, mat: cell(row, col.mat), nom: cell(row, col.nom), ag: cell(row, col.ag), pres: cell(row, col.pres), dt: cell(row, col.dt), sin: sinRaw, prix: round2(rawPrice), row: rowNumber };
    if (digits.length === 10) conv.push({ ...line, sin: digits });
    else if (digits.length === 12) takaful.push({ ...line, sin: digits });
    else unknown.push({ row: rowNumber, dos, sin: sinRaw, reason: digits ? `Numéro de sinistre de ${digits.length} chiffres (10 attendus en conventionnel, 12 en Takaful).` : "Numéro de sinistre absent." });
  }
  if (conv.length + takaful.length + unknown.length === 0) return fail("Aucun dossier trouvé sous l'en-tête du fichier.", "VALIDATION");

  const sum = (lines: GamLine[]): number => round2(lines.reduce((total, line) => total + line.prix, 0));
  const convHt = sum(conv);
  const takafulHt = sum(takaful);
  const totalHt = round2(convHt + takafulHt);
  const duplicates = [...seen.entries()].filter(([, found]) => found.length > 1).map(([dos, found]) => ({ dos, rows: found }));
  const controlOk = fileTotalHt !== null && Math.abs(totalHt - fileTotalHt) < 0.01 && unknown.length === 0;
  return ok({ conv, takaful, unknown, duplicates, fileNum, fileDate, fileTotalHt, convHt, takafulHt, totalHt, controlOk });
}

/** Ligne de facture du modèle « bdggam » (colonnes dos, mat, nom, ag, pres, dt, sin, prix). */
export function gamLineToBillingRow(line: GamLine): Record<string, string> {
  return { dos: line.dos, mat: line.mat, nom: line.nom, ag: line.ag, pres: line.pres, dt: line.dt, sin: line.sin, prix: line.prix.toFixed(2) };
}
