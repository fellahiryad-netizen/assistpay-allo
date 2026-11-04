import type { SheetCell, SheetData } from "@/lib/spreadsheet";
import { round2 } from "@/utils/amounts";
import { upperPlain } from "@/utils/text";

/** Succursales CAAT régularisées. */
export const REGUL_SUCCURSALES = ["ALGER I", "ALGER II", "ALGER III", "ANNABA", "CONSTANTINE", "ORAN", "SETIF", "SUD", "TLEMCEN"] as const;

/** Nom lisible des succursales. */
export const REGUL_LABELS: Readonly<Record<string, string>> = {
  "ALGER I": "Alger I",
  "ALGER II": "Alger II",
  "ALGER III": "Alger III",
  ANNABA: "Annaba",
  CONSTANTINE: "Constantine",
  ORAN: "Oran",
  SETIF: "Sétif",
  SUD: "Sud",
  TLEMCEN: "Tlemcen",
};

/** Périodes de régularisation : mois couverts. */
export const REGUL_PERIODS: Readonly<Record<string, number[]>> = { T1: [1, 2, 3], T2: [4, 5, 6], T3: [7, 8, 9], T4: [10, 11, 12], S1: [1, 2, 3, 4, 5, 6], S2: [7, 8, 9, 10, 11, 12] };

/** Ligne d'un fichier « arrêté comptablement ». */
export interface RegulLine {
  m: number;
  fichier: string;
  immat: string;
  agence: string;
  client: string;
  code: number;
  ville: string;
  marque: string;
  emis: string;
  /** Mois d'émission lu (0 si illisible). */
  em: number;
  police: string;
  debut: string;
  fin: string;
  produit: string;
  prime: number;
  pa: number;
  /** Nombre de garanties distinctes pour la même immatriculation (lignes négatives seulement). */
  nprod: number;
  /** Une ligne positive de la même police et du même véhicule existe dans la période. */
  plus: boolean;
  soldePrime: number;
  soldePa: number;
  autres: string;
}

/** Fichier lu : lignes et mois détecté. */
export interface RegulFile {
  name: string;
  mois: number;
  lignes: Omit<RegulLine, "m" | "fichier" | "nprod" | "plus" | "soldePrime" | "soldePa" | "autres">[];
}

const COLUMNS = ["IMMATRICULATION", "AGENCE", "CLIENT", "CODE_AGENCE", "VILLE", "MARQUE", "DATE_EMMISSION", "POLICE", "DATE_DEBUT", "DATE_FIN", "PRODUIT", "PRIME", "PART_ASSISTEUR"] as const;
const FILE_MONTHS: ReadonlyArray<[string, number]> = [["JANV", 1], ["FEV", 2], ["MARS", 3], ["AVR", 4], ["MAI", 5], ["JUIN", 6], ["JUIL", 7], ["AOUT", 8], ["SEPT", 9], ["OCT", 10], ["NOV", 11], ["DEC", 12]];

const pad = (n: number): string => String(n).padStart(2, "0");

function text(cell: SheetCell | undefined): string {
  if (cell === null || cell === undefined) return "";
  if (cell instanceof Date) return `${pad(cell.getUTCDate())}/${pad(cell.getUTCMonth() + 1)}/${cell.getUTCFullYear()}`;
  return String(cell).trim();
}

function amount(cell: SheetCell | undefined): number {
  if (typeof cell === "number") return cell;
  if (cell === null || cell === undefined || cell instanceof Date) return 0;
  const value = parseFloat(String(cell).replace(/[\s  ]/g, "").replace(",", "."));
  return Number.isNaN(value) ? 0 : value;
}

/** Mois d'émission d'une ligne (0 si illisible). */
function emissionMonth(cell: SheetCell | undefined): number {
  if (cell instanceof Date) return cell.getUTCMonth() + 1;
  if (typeof cell === "number" && cell < 100000) return new Date(Math.round((cell - 25569) * 864e5)).getUTCMonth() + 1;
  let digits = String(cell ?? "").replace(/\D/g, "");
  if (digits.length === 7) digits = `0${digits}`;
  return digits.length === 8 ? Number(digits.slice(2, 4)) : 0;
}

/** Mois cité dans le nom d'un fichier (« ALLO_ASS_AOUT_2026.xlsx »), 0 si absent. */
export function monthFromName(name: string): number {
  const plain = upperPlain(name);
  return FILE_MONTHS.find(([prefix]) => plain.includes(prefix))?.[1] ?? 0;
}

/** Lit un fichier de production : feuille « DETAIL » en priorité, sinon la première qui porte les colonnes attendues. */
export function parseRegulFile(name: string, sheets: SheetData[]): RegulFile | null {
  const ordered = [...sheets].sort((a, b) => Number(/DETAIL/i.test(b.name)) - Number(/DETAIL/i.test(a.name)));
  for (const sheet of ordered) {
    const headIndex = sheet.rows.findIndex((row) => row.some((cell) => text(cell).toUpperCase() === "IMMATRICULATION"));
    if (headIndex < 0) continue;
    const head = (sheet.rows[headIndex] ?? []).map((cell) => text(cell).toUpperCase());
    const at = Object.fromEntries(COLUMNS.map((column) => [column, head.indexOf(column)])) as Record<(typeof COLUMNS)[number], number>;
    if (at.POLICE < 0 || at.PRIME < 0 || at.PART_ASSISTEUR < 0 || at.CODE_AGENCE < 0) continue;
    const lignes: RegulFile["lignes"] = [];
    const months = new Map<number, number>();
    for (const row of sheet.rows.slice(headIndex + 1)) {
      const get = (column: (typeof COLUMNS)[number]): SheetCell | undefined => (at[column] >= 0 ? row[at[column]] : undefined);
      const police = text(get("POLICE"));
      if (!police && text(get("PRIME")) === "") continue;
      const code = parseInt(text(get("CODE_AGENCE")), 10);
      if (Number.isNaN(code) && !police) continue;
      const immat = text(get("IMMATRICULATION"));
      const em = emissionMonth(get("DATE_EMMISSION"));
      if (em) months.set(em, (months.get(em) ?? 0) + 1);
      lignes.push({
        immat: /^[=#]/.test(immat) ? "IMMAT ILLISIBLE (source)" : immat,
        agence: text(get("AGENCE")),
        client: text(get("CLIENT")),
        code: Number.isNaN(code) ? 0 : code,
        ville: text(get("VILLE")),
        marque: text(get("MARQUE")),
        emis: text(get("DATE_EMMISSION")),
        em,
        police,
        debut: text(get("DATE_DEBUT")),
        fin: text(get("DATE_FIN")),
        produit: text(get("PRODUIT")),
        prime: amount(get("PRIME")),
        pa: amount(get("PART_ASSISTEUR")),
      });
    }
    if (!lignes.length) continue;
    const top = [...months.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
    return { name, mois: monthFromName(name) || top, lignes };
  }
  return null;
}

const norm = (value: string): string => value.replace(/[ \-.]/g, "").toUpperCase();
const basePolice = (value: string): string => {
  const trimmed = value.trim();
  const slash = trimmed.lastIndexOf("/");
  return (slash > 0 ? trimmed.slice(0, slash) : trimmed).toUpperCase();
};

/** Montants saisis (ou repris des avances) pour un mois. */
export interface RegulMonthInput {
  /** Montant total arrêté (vide : égal au régule des fichiers). */
  total?: number;
  avance: number;
}

/** Ligne du récapitulatif mensuel. */
export interface RegulMonthRow {
  m: number;
  fichier: boolean;
  total: number;
  avance: number;
  regule: number;
  ecart: number;
  tva: number;
  pa: number;
}

/** Agence : production par mois dans les fichiers. */
export interface RegulAgency {
  code: number;
  nom: string;
  mois: Array<{ m: number; n: number; pa: number }>;
}

/** Résultat complet de l'analyse. */
export interface RegulAnalysis {
  succursale: string;
  periode: string;
  annee: number;
  months: number[];
  fichiers: Array<{ name: string; mois: number; lignes: number; hors: boolean }>;
  nonLus: string[];
  valid: RegulLine[];
  annul: RegulLine[];
  garan: RegulLine[];
  rows: RegulMonthRow[];
  totals: { total: number; avance: number; regule: number; ecart: number; tva: number; pa: number };
  agences: RegulAgency[];
  flottes: Array<{ police: string; mois: number[] }>;
  horsMois: number;
  illisibles: number;
  /** Mois de la période pour lesquels aucun fichier n'a été déposé. */
  sansFichier: number[];
}

/** Analyse les fichiers d'une succursale pour une période : valides, annulations, changements de garantie, 10 % HT + TVA. */
export function analyseRegul(
  succursale: string,
  periode: string,
  annee: number,
  files: RegulFile[],
  nonLus: string[],
  inputs: Record<number, RegulMonthInput>,
): RegulAnalysis {
  const months = REGUL_PERIODS[periode] ?? [];
  const used = files.filter((file) => months.includes(file.mois));
  const lines: RegulLine[] = [];
  for (const file of used) {
    for (const l of file.lignes) lines.push({ ...l, m: file.mois, fichier: file.name, nprod: 1, plus: false, soldePrime: 0, soldePa: 0, autres: "" });
  }
  const byImmat = new Map<string, RegulLine[]>();
  for (const l of lines) {
    const key = norm(l.immat);
    if (!key) continue;
    byImmat.set(key, [...(byImmat.get(key) ?? []), l]);
  }
  const plusSet = new Set(lines.filter((l) => l.prime > 0).map((l) => `${basePolice(l.police)}|${norm(l.immat)}`));
  const valid: RegulLine[] = [];
  const annul: RegulLine[] = [];
  const garan: RegulLine[] = [];
  for (const l of lines) {
    if (l.prime >= 0) {
      valid.push(l);
      continue;
    }
    const same = byImmat.get(norm(l.immat)) ?? [];
    l.nprod = norm(l.immat) ? new Set(same.map((y) => y.produit)).size : 1;
    (l.nprod > 1 ? garan : annul).push(l);
  }
  for (const l of annul) {
    l.plus = plusSet.has(`${basePolice(l.police)}|${norm(l.immat)}`);
    const kept = (byImmat.get(norm(l.immat)) ?? []).filter((y) => y.prime >= 0 || y.nprod <= 1);
    l.soldePrime = round2(kept.reduce((s, y) => s + y.prime, 0));
    l.soldePa = round2(kept.reduce((s, y) => s + y.pa, 0));
  }
  for (const l of garan) l.autres = [...new Set((byImmat.get(norm(l.immat)) ?? []).map((y) => y.produit))].filter((p) => p !== l.produit).join(", ");
  const cmp = (a: RegulLine, b: RegulLine): number => a.m - b.m || a.code - b.code || a.police.localeCompare(b.police);
  valid.sort(cmp);
  annul.sort(cmp);
  garan.sort(cmp);

  const regule = new Map<number, number>(months.map((m) => [m, 0]));
  for (const l of lines) regule.set(l.m, round2((regule.get(l.m) ?? 0) + l.pa));
  const rows: RegulMonthRow[] = months.map((m) => {
    const input = inputs[m] ?? { avance: 0 };
    const reg = regule.get(m) ?? 0;
    const ecart = round2(reg - input.avance);
    const tva = round2(reg * 0.19);
    return { m, fichier: used.some((f) => f.mois === m), total: input.total ?? reg, avance: input.avance, regule: reg, ecart, tva, pa: round2(ecart + tva) };
  });
  const sum = (pick: (r: RegulMonthRow) => number): number => round2(rows.reduce((s, r) => s + pick(r), 0));
  const names = new Map<number, string>();
  for (const l of lines) if (l.agence) names.set(l.code, l.agence);
  const agg = new Map<number, Map<number, { n: number; pa: number }>>();
  for (const l of lines) {
    const perMonth = agg.get(l.code) ?? new Map<number, { n: number; pa: number }>();
    const cell = perMonth.get(l.m) ?? { n: 0, pa: 0 };
    cell.n += 1;
    cell.pa += l.pa;
    perMonth.set(l.m, cell);
    agg.set(l.code, perMonth);
  }
  const agences: RegulAgency[] = [...agg.keys()]
    .filter((c) => c)
    .sort((a, b) => a - b)
    .map((code) => ({ code, nom: names.get(code) ?? "", mois: months.map((m) => ({ m, n: agg.get(code)?.get(m)?.n ?? 0, pa: round2(agg.get(code)?.get(m)?.pa ?? 0) })) }));
  const polices = new Map<string, Set<number>>();
  for (const l of valid) polices.set(l.police, (polices.get(l.police) ?? new Set<number>()).add(l.m));
  return {
    succursale,
    periode,
    annee,
    months,
    fichiers: files.map((f) => ({ name: f.name, mois: f.mois, lignes: f.lignes.length, hors: !months.includes(f.mois) })),
    nonLus,
    valid,
    annul,
    garan,
    rows,
    totals: { total: sum((r) => r.total), avance: sum((r) => r.avance), regule: sum((r) => r.regule), ecart: sum((r) => r.ecart), tva: sum((r) => r.tva), pa: sum((r) => r.pa) },
    agences,
    flottes: [...polices.entries()].filter(([, set]) => set.size > 1).map(([police, set]) => ({ police, mois: [...set].sort((a, b) => a - b) })),
    horsMois: lines.filter((l) => l.em !== 0 && l.em !== l.m).length,
    illisibles: lines.filter((l) => norm(l.immat).length < 4).length,
    sansFichier: months.filter((m) => !used.some((f) => f.mois === m)),
  };
}
