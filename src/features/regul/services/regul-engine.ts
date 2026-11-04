import type { SheetCell, SheetData } from "@/lib/spreadsheet";
import { round2 } from "@/utils/amounts";
import { upperPlain } from "@/utils/text";

/* Moteur de la régularisation CAAT 10 % + TVA : fonctions pures, utilisables dans le navigateur (les fichiers déposés n'en sortent pas). */

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

/** Mois en toutes lettres. */
export const REGUL_MOIS = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"] as const;

/** Périodes de régularisation : mois couverts. */
export const REGUL_PERIODS: Readonly<Record<string, number[]>> = { T1: [1, 2, 3], T2: [4, 5, 6], T3: [7, 8, 9], T4: [10, 11, 12], S1: [1, 2, 3, 4, 5, 6] };

/** Garanties de la base de production (position = code stocké). */
export const REGUL_PROD = ["Rapide", "Securite", "Aisance", "10 --20 tonnes", "3,5 --10 tonnes", "Plusde 20tonnes"] as const;

/** Ligne de la base de production : [mois, code agence, police, immatriculation, garantie, prime, part assisteur]. */
export type BaseRow = [number, number, string, string, number, number, number];

/** Avance et total d'un mois (TCD du consolidé ou saisie). */
export interface TcdMonth {
  total: number;
  avance: number;
  statut: string;
}

/** Régularisation déjà faite (classeur, historique ou résultat enregistré). */
export interface Fait {
  total: number;
  avance: number;
  regule: number;
  ecart: number;
  tva: number;
  pa: number;
  releve?: number | null;
  statut?: string;
  src?: string;
  base?: number | null;
  top?: string;
}

/** Index de la base de production. */
export interface RegulIndex {
  prod: string[];
  faits: Record<string, Record<string, Fait>>;
  baseMois: Record<string, Record<string, number>>;
  tcd: Record<string, Record<string, TcdMonth>>;
  agences: Record<string, string>;
  lignes: Record<string, number>;
  maj: string;
  source: string;
}

/** Base sinistres : clés « police sans avenant | immatriculation ». */
export interface RegulSin {
  keys: string[];
  jusqua: string;
  maj: string;
  dossiers: number;
}

/** Montants saisis à la main pour un mois (clé « SUCC_ID-AAAA-MM »). */
export interface Saisie {
  succ: string;
  total?: number | null;
  avance?: number | null;
}

/** Résultat enregistré dans le suivi. */
export interface RegulSaved {
  succ: string;
  mois: number;
  annee: number;
  total: number;
  avance: number;
  regule: number;
  ecart: number;
  tva: number;
  pa: number;
  base: number;
  top: string;
  fichiers: string[];
  maj: string;
}

/** Ligne d'un fichier « arrêté comptablement ». */
export interface RegulLine {
  immat: string;
  agence: string;
  client: string;
  code: number;
  ville: string;
  marque: string;
  emis: string;
  em: number;
  police: string;
  debut: string;
  fin: string;
  produit: string;
  prime: number;
  pa: number;
}

/** Fichier lu : lignes et mois. */
export interface RegulFile {
  id: string;
  name: string;
  mois: number;
  moisFichier: number;
  moisEmission: number;
  lignes: RegulLine[];
}

/** Ligne analysée. */
export interface AnalysedLine extends RegulLine {
  m: number;
  fichier: string;
  im: string;
  bp: string;
  nprod: number;
  plus: boolean;
  sinistre: boolean | null;
  soldePrime: number;
  soldePa: number;
  autres: string;
}

const COLUMNS = ["IMMATRICULATION", "AGENCE", "CLIENT", "CODE_AGENCE", "VILLE", "MARQUE", "DATE_EMMISSION", "POLICE", "DATE_DEBUT", "DATE_FIN", "PRODUIT", "PRIME", "PART_ASSISTEUR"] as const;
const FILE_MONTHS: ReadonlyArray<[string, number]> = [["JANV", 1], ["FEV", 2], ["MARS", 3], ["AVR", 4], ["MAI", 5], ["JUIN", 6], ["JUIL", 7], ["AOUT", 8], ["SEPT", 9], ["OCT", 10], ["NOV", 11], ["DEC", 12]];
const pad = (n: number): string => String(n).padStart(2, "0");

function text(cell: SheetCell | undefined): string {
  if (cell === null || cell === undefined) return "";
  if (cell instanceof Date) return `${pad(cell.getUTCDate())}/${pad(cell.getUTCMonth() + 1)}/${cell.getUTCFullYear()}`;
  return String(cell).trim();
}

/** Nombre lu dans une cellule (« 1 000,50 » accepté). */
export function toAmount(cell: SheetCell | undefined): number {
  if (typeof cell === "number") return cell;
  if (cell === null || cell === undefined || cell instanceof Date) return 0;
  const value = parseFloat(String(cell).replace(/[\s  ]/g, "").replace(",", "."));
  return Number.isNaN(value) ? 0 : value;
}

/** Mois d'émission d'une cellule (0 si illisible). */
function emissionMonth(cell: SheetCell | undefined): number {
  if (cell instanceof Date) return cell.getUTCMonth() + 1;
  if (typeof cell === "number" && cell < 100000) return new Date(Math.round((cell - 25569) * 864e5)).getUTCMonth() + 1;
  let digits = String(cell ?? "").replace(/\D/g, "");
  if (digits.length === 7) digits = `0${digits}`;
  return digits.length === 8 ? Number(digits.slice(2, 4)) : 0;
}

/** Mois cité dans un nom de fichier (« ALLO_ASS_AOUT_2026.xlsx »), 0 si absent. */
export function monthFromName(name: string): number {
  const plain = upperPlain(name);
  return FILE_MONTHS.find(([prefix]) => plain.includes(prefix))?.[1] ?? 0;
}

/** Lit un fichier de production (feuille DETAIL en priorité) ; liste vide si les colonnes attendues manquent. Un fichier de plusieurs mois sans mois dans son nom est scindé par mois d'émission. */
export function parseRegulFile(name: string, size: number, sheets: SheetData[], defaultYear: number): RegulFile[] {
  void defaultYear;
  const ordered = [...sheets].sort((a, b) => Number(/DETAIL/i.test(b.name)) - Number(/DETAIL/i.test(a.name)));
  for (const sheet of ordered) {
    const headIndex = sheet.rows.findIndex((row) => row.some((cell) => text(cell).toUpperCase() === "IMMATRICULATION"));
    if (headIndex < 0) continue;
    const head = (sheet.rows[headIndex] ?? []).map((cell) => text(cell).toUpperCase());
    const at = Object.fromEntries(COLUMNS.map((column) => [column, head.indexOf(column)])) as Record<(typeof COLUMNS)[number], number>;
    if (at.POLICE < 0 || at.PRIME < 0 || at.PART_ASSISTEUR < 0 || at.CODE_AGENCE < 0) continue;
    const lignes: RegulLine[] = [];
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
        prime: toAmount(get("PRIME")),
        pa: toAmount(get("PART_ASSISTEUR")),
      });
    }
    if (!lignes.length) continue;
    const top = [...months.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
    const fm = monthFromName(name);
    if (!fm && months.size > 1) {
      // Fichier couvrant plusieurs mois (ex. un trimestre) sans mois dans son nom : un lot par mois d'émission.
      const parMois = new Map<number, RegulLine[]>();
      for (const ligne of lignes) {
        const key = ligne.em || top;
        parMois.set(key, [...(parMois.get(key) ?? []), ligne]);
      }
      return [...parMois.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([mois, part]) => ({ id: `${name}|${size}|${mois}`, name: `${name} (${(REGUL_MOIS[mois - 1] ?? "").toLowerCase()})`, mois, moisFichier: 0, moisEmission: mois, lignes: part }));
    }
    return [{ id: `${name}|${size}`, name, mois: fm || top, moisFichier: fm, moisEmission: top, lignes }];
  }
  return [];
}

/** Normalise une immatriculation ou un numéro (sans espace, tiret ni point, majuscules). */
export const norm = (value: string): string => value.replace(/[ \-.]/g, "").toUpperCase();
const cmpKey = (value: string): string => norm(value).replace(/^0+/, "");
/** Police sans avenant (partie avant la dernière barre oblique). */
export const basePolice = (value: string): string => {
  const trimmed = value.trim();
  const slash = trimmed.lastIndexOf("/");
  return (slash > 0 ? trimmed.slice(0, slash) : trimmed).toUpperCase();
};
/** Identifiant d'une succursale pour les clés (espaces remplacés). */
export const succId = (succ: string): string => succ.replace(/ /g, "_");

/** Ligne du tableau de contrôle par agence. */
export interface AgencyRow {
  code: number;
  nom: string;
  par: Array<{ m: number; b: { n: number; pa: number }; f: { n: number; pa: number } }>;
}

/** Résultat de l'analyse d'une succursale pour une période. */
export interface Analysis {
  s: string;
  months: number[];
  files: RegulFile[];
  L: AnalysedLine[];
  valid: AnalysedLine[];
  annul: AnalysedLine[];
  garan: AnalysedLine[];
  regule: Record<number, number>;
  baseM: Record<number, { n: number; pa: number }>;
  agTab: AgencyRow[];
  manquantes: Array<{ code: number; nom: string; m: number; basePa: number; baseN: number }>;
  nouvelles: AgencyRow[];
  flottes: Array<{ police: string; mois: number[] }>;
  horsMois: number;
  illisibles: number;
  onlyFile: AnalysedLine[];
  onlyBase: Array<{ m: number; code: number; police: string; immat: string; produit: string; prime: number; pa: number }>;
  immatDiff: number;
  baseN: number;
}

/** Analyse les fichiers d'une succursale : valides, annulations, changements de garantie, sinistres et comparaison avec la base de production. */
export function analyse(succ: string, periode: string, allFiles: RegulFile[], base: BaseRow[], sin: Set<string> | null, idx: RegulIndex | null): Analysis {
  const months = REGUL_PERIODS[periode] ?? [];
  const files = allFiles.filter((f) => months.includes(f.mois));
  const L: AnalysedLine[] = [];
  for (const f of files) {
    for (const l of f.lignes) L.push({ ...l, m: f.mois, fichier: f.name, im: norm(l.immat), bp: basePolice(l.police), nprod: 1, plus: false, sinistre: null, soldePrime: 0, soldePa: 0, autres: "" });
  }
  const byIm = new Map<string, AnalysedLine[]>();
  for (const x of L) {
    if (!x.im) continue;
    byIm.set(x.im, [...(byIm.get(x.im) ?? []), x]);
  }
  const plusSet = new Set<string>();
  for (const x of L) if (x.prime > 0) plusSet.add(`${x.bp}|${x.im}`);
  const valid: AnalysedLine[] = [];
  const annul: AnalysedLine[] = [];
  const garan: AnalysedLine[] = [];
  for (const x of L) {
    if (x.prime >= 0) {
      valid.push(x);
      continue;
    }
    x.nprod = x.im ? new Set((byIm.get(x.im) ?? []).map((y) => y.produit)).size : 1;
    (x.nprod > 1 ? garan : annul).push(x);
  }
  for (const x of annul) {
    x.plus = plusSet.has(`${x.bp}|${x.im}`);
    x.sinistre = sin ? sin.has(`${x.bp}|${x.im}`) : null;
    const inSet = (byIm.get(x.im) ?? []).filter((y) => y.prime >= 0 || y.nprod <= 1);
    x.soldePrime = round2(inSet.reduce((a, y) => a + y.prime, 0));
    x.soldePa = round2(inSet.reduce((a, y) => a + y.pa, 0));
  }
  for (const x of garan) x.autres = [...new Set((byIm.get(x.im) ?? []).map((y) => y.produit))].filter((p) => p !== x.produit).join(", ");
  const cmp = (a: AnalysedLine, b: AnalysedLine): number => a.m - b.m || a.code - b.code || (a.police < b.police ? -1 : a.police > b.police ? 1 : 0);
  valid.sort(cmp);
  annul.sort(cmp);
  garan.sort(cmp);
  const regule: Record<number, number> = {};
  for (const m of months) regule[m] = 0;
  for (const x of L) regule[x.m] = round2((regule[x.m] ?? 0) + x.pa);

  const bm = new Map<string, BaseRow[]>();
  const bAg: Record<number, Record<number, { n: number; pa: number }>> = {};
  const hist = new Set<number>();
  for (const r of base) hist.add(r[1]);
  const fAg: Record<number, Record<number, { n: number; pa: number }>> = {};
  for (const x of L) {
    const byMonth = (fAg[x.code] ??= {});
    const cell = (byMonth[x.m] ??= { n: 0, pa: 0 });
    cell.n++;
    cell.pa += x.pa;
  }
  const baseM: Record<number, { n: number; pa: number }> = {};
  for (const m of months) baseM[m] = { n: 0, pa: 0 };
  for (const r of base) {
    if (!months.includes(r[0])) continue;
    const byMonth = (bAg[r[1]] ??= {});
    const cell = (byMonth[r[0]] ??= { n: 0, pa: 0 });
    cell.n++;
    cell.pa += r[6];
    const bmCell = baseM[r[0]];
    if (bmCell) {
      bmCell.n++;
      bmCell.pa += r[6];
    }
    const k = `${r[0]}|${r[2]}|${cmpKey(r[3])}|${r[5].toFixed(2)}|${r[6].toFixed(2)}`;
    bm.set(k, [...(bm.get(k) ?? []), r]);
  }
  const fm = new Map<string, AnalysedLine[]>();
  for (const x of L) {
    const k = `${x.m}|${x.police}|${cmpKey(x.immat)}|${x.prime.toFixed(2)}|${x.pa.toFixed(2)}`;
    fm.set(k, [...(fm.get(k) ?? []), x]);
  }
  let onlyFile: AnalysedLine[] = [];
  let onlyBase: Analysis["onlyBase"] = [];
  const prod = idx?.prod ?? [...REGUL_PROD];
  if (base.length && L.length) {
    for (const [k, v] of fm) {
      const b = bm.get(k) ?? [];
      if (v.length > b.length) onlyFile.push(...v.slice(b.length));
    }
    for (const [k, v] of bm) {
      const f = fm.get(k) ?? [];
      if (v.length > f.length) for (const r of v.slice(f.length)) onlyBase.push({ m: r[0], code: r[1], police: r[2], immat: r[3], produit: prod[r[4]] ?? "", prime: r[5], pa: r[6] });
    }
  }
  let immatDiff = 0;
  if (onlyFile.length && onlyBase.length) {
    const k2 = (m: number, p: string, pr: number, pa: number): string => `${m}|${p}|${pr.toFixed(2)}|${pa.toFixed(2)}`;
    const bb = new Map<string, number[]>();
    onlyBase.forEach((r, i) => {
      const k = k2(r.m, r.police, r.prime, r.pa);
      bb.set(k, [...(bb.get(k) ?? []), i]);
    });
    const dropF = new Set<number>();
    const dropB = new Set<number>();
    onlyFile.forEach((x, i) => {
      const list = bb.get(k2(x.m, x.police, x.prime, x.pa));
      const taken = list?.shift();
      if (taken !== undefined) {
        dropB.add(taken);
        dropF.add(i);
        immatDiff++;
      }
    });
    if (dropF.size) {
      onlyFile = onlyFile.filter((_, i) => !dropF.has(i));
      onlyBase = onlyBase.filter((_, i) => !dropB.has(i));
    }
  }
  const codes = [...new Set([...Object.keys(fAg).map(Number), ...Object.keys(bAg).map(Number), ...hist])].filter((c) => c).sort((a, b) => a - b);
  const names: Record<number, string> = {};
  for (const x of L) if (x.agence) names[x.code] = x.agence;
  const idxN = idx?.agences ?? {};
  const agTab: AgencyRow[] = codes.map((c) => ({
    code: c,
    nom: names[c] ?? idxN[String(c)] ?? "",
    par: months.map((m) => ({ m, b: bAg[c]?.[m] ?? { n: 0, pa: 0 }, f: fAg[c]?.[m] ?? { n: 0, pa: 0 } })),
  }));
  const manquantes: Analysis["manquantes"] = [];
  const nouvelles: AgencyRow[] = [];
  const m0 = months.length ? Math.min(...months) : 1;
  for (const a of agTab) {
    for (const p of a.par) if (hist.has(a.code) && !p.f.n && files.some((f) => f.mois === p.m)) manquantes.push({ code: a.code, nom: a.nom, m: p.m, basePa: p.b.pa, baseN: p.b.n });
    if (m0 > 1 && a.par.some((p) => p.f.n) && !base.some((r) => r[1] === a.code && r[0] < m0)) nouvelles.push(a);
  }
  const polM = new Map<string, Set<number>>();
  for (const x of valid) polM.set(x.police, (polM.get(x.police) ?? new Set<number>()).add(x.m));
  const flottes = [...polM.entries()].filter(([, s]) => s.size > 1).map(([police, s]) => ({ police, mois: [...s].sort((a, b) => a - b) }));
  return {
    s: succ,
    months,
    files,
    L,
    valid,
    annul,
    garan,
    regule,
    baseM,
    agTab,
    manquantes,
    nouvelles,
    flottes,
    horsMois: L.filter((x) => x.em !== 0 && x.em !== x.m).length,
    illisibles: L.filter((x) => x.im.length < 4).length,
    onlyFile,
    onlyBase,
    immatDiff,
    baseN: base.length,
  };
}

/** Total et avance d'un mois : saisie manuelle, sinon TCD du consolidé. */
export function saisieOf(succ: string, year: number, m: number, idx: RegulIndex | null, saisies: Record<string, Saisie>): { key: string; total: number; avance: number; statut: string; edited: boolean } {
  const mm = pad(m);
  const key = `${succId(succ)}-${year}-${mm}`;
  const sv = saisies[key];
  const t = idx?.tcd?.[succ]?.[`${year}-${mm}`];
  return { key, total: sv?.total != null ? sv.total : (t?.total ?? 0), avance: sv?.avance != null ? sv.avance : (t?.avance ?? 0), statut: t?.statut ?? "", edited: Boolean(sv) };
}

/** Ligne du tableau de régularisation. */
export interface CalcRow {
  m: number;
  total: number;
  avance: number;
  regule: number;
  ecart: number;
  tva: number;
  pa: number;
  statut: string;
  key: string;
  hasFile: boolean;
}

/** Calcule 10 % HT + TVA 19 % mois par mois. */
export function calc(a: Analysis, year: number, idx: RegulIndex | null, saisies: Record<string, Saisie>): { rows: CalcRow[]; tot: { total: number; avance: number; regule: number; ecart: number; tva: number; pa: number } } {
  const rows = a.months.map((m) => {
    const sa = saisieOf(a.s, year, m, idx, saisies);
    const reg = a.regule[m] ?? 0;
    const ec = reg - sa.avance;
    const tva = reg * 0.19;
    return { m, total: sa.total, avance: sa.avance, regule: reg, ecart: ec, tva, pa: ec + tva, statut: sa.statut, key: sa.key, hasFile: a.files.some((f) => f.mois === m) };
  });
  const tot = { total: 0, avance: 0, regule: 0, ecart: 0, tva: 0, pa: 0 };
  for (const r of rows) {
    tot.total += r.total;
    tot.avance += r.avance;
    tot.regule += r.regule;
    tot.ecart += r.ecart;
    tot.tva += r.tva;
    tot.pa += r.pa;
  }
  return { rows, tot: { total: round2(tot.total), avance: round2(tot.avance), regule: round2(tot.regule), ecart: round2(tot.ecart), tva: round2(tot.tva), pa: round2(tot.pa) } };
}

/** Agences qui expliquent l'écart d'un mois (écart fichier − base, 4 plus grands). */
export function topAgencies(a: Analysis, m: number): string {
  return a.agTab
    .map((ag) => {
      const p = ag.par.find((x) => x.m === m);
      return { c: ag.code, d: p ? round2(p.f.pa - p.b.pa) : 0 };
    })
    .filter((x) => Math.abs(x.d) >= 500)
    .sort((x, y) => Math.abs(y.d) - Math.abs(x.d))
    .slice(0, 4)
    .map((x) => `${x.c} (${x.d > 0 ? "+" : ""}${Math.round(x.d).toLocaleString("fr-FR")})`)
    .join(" · ");
}
