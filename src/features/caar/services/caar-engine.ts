import type { SheetCell, SheetData } from "@/lib/spreadsheet";
import { round2 } from "@/utils/amounts";
import { parseLooseDate } from "@/utils/dates";

/** Anomalies relevées dans un fichier de production (libellés repris de l'ancienne version). */
export const CAAR_FLAGS = {
  AG_MISSING: { label: "Code agence manquant ou NA", severity: "err", ask: "Code agence manquant ou en NA" },
  POL_MISSING: { label: "N° de police manquant ou NA", severity: "err", ask: "N° de police manquant ou en NA" },
  PRIME_MISSING: { label: "Prime nette manquante ou illisible", severity: "err", ask: "Prime nette manquante ou illisible" },
  IMM_MISSING: { label: "Immatriculation manquante ou NA", severity: "err", ask: "Immatriculation manquante ou en NA" },
  NOM_MISSING: { label: "Nom de l'assuré manquant ou NA", severity: "warn", ask: "Nom de l'assuré manquant ou en NA" },
  DATE_ORDER: { label: "Échéance avant la date d'effet", severity: "warn", ask: "Date d'échéance antérieure à la date d'effet" },
  ETAT_KO: { label: "Quittance annulée / non encaissée", severity: "warn", ask: "Quittance annulée ou non encaissée" },
  DUP: { label: "Doublon (police + avenant + immat.)", severity: "warn", ask: "Ligne en double" },
  TOTAL: { label: "Ligne de total détectée", severity: "info", ask: null },
  HEADER: { label: "En-tête répété détecté", severity: "info", ask: null },
  PRIME_KO: { label: "Prime non conforme au barème", severity: "warn", ask: "Prime non conforme au barème (produit / durée)" },
  PROD_UNK: { label: "Formule absente ou non reconnue", severity: "warn", ask: "Formule d'assistance absente ou non reconnue" },
  PRIME_FLOTTE: { label: "Prime de flotte (plusieurs véhicules)", severity: "info", ask: null },
  TUNISIE: { label: "Formule Tunisie (hors Allo Assistance)", severity: "info", ask: null },
  PRIME_ZERO: { label: "Prime à zéro", severity: "info", ask: null },
  PRIME_NEG: { label: "Prime négative (ristourne)", severity: "info", ask: null },
} as const;
export type CaarFlag = keyof typeof CAAR_FLAGS;

/** Produits d'assistance CAAR et tarif annuel. */
export const CAAR_PRODUCTS: ReadonlyArray<{ id: string; label: string; annual: number; cg: string }> = [
  { id: "F0", label: "Formule 0 (≤ 50 km)", annual: 1200, cg: "ASS0" },
  { id: "F1", label: "Formule 1 (≤ 100 km)", annual: 2400, cg: "ASS3" },
  { id: "F2", label: "Formule 2 (≤ 200 km)", annual: 3500, cg: "ASS1" },
  { id: "F3", label: "Formule 3 (Territoire national)", annual: 6000, cg: "ASS5" },
  { id: "SH", label: "Formule SONATRACH", annual: 2000, cg: "ASS7" },
  { id: "L1", label: "Lourd F01 (3,5 T à 10 T)", annual: 6000, cg: "ASS10" },
  { id: "L1R", label: "Lourd F01 réduite", annual: 5000, cg: "ASS13" },
  { id: "L2", label: "Lourd F02 (10 T à 20 T)", annual: 7000, cg: "ASS11" },
  { id: "L2R", label: "Lourd F02 réduite", annual: 6000, cg: "ASS14" },
  { id: "L3", label: "Lourd F03 (plus de 20 T)", annual: 9000, cg: "ASS12" },
  { id: "L3R", label: "Lourd F03 réduite", annual: 8000, cg: "ASS15" },
  { id: "AZUR", label: "Formule Azur", annual: 5100, cg: "ASSZ" },
  { id: "AZS", label: "Formule 3 Azur agent de secteur", annual: 1800, cg: "ASS17" },
  { id: "SOL", label: "Formule 2 Soleil agent de secteur", annual: 1200, cg: "ASS16" },
  { id: "SECU", label: "Formule Sécurité", annual: 2000, cg: "ASSS" },
  { id: "TAXI", label: "Pro-Assist 3 Taxi / location", annual: 7000, cg: "ASS21" },
  { id: "TAXI1", label: "Pro-Assist 1 Taxi / location", annual: 3000, cg: "ASS19" },
  { id: "AZURC", label: "Formule Azur (Conventions)", annual: 5500, cg: "" },
  { id: "CLAR", label: "Formule Clarté", annual: 2400, cg: "" },
  { id: "LUEUR", label: "Formule Lueur", annual: 1200, cg: "" },
  { id: "CONV", label: "Formule 3500 Conventions", annual: 3500, cg: "ASS9" },
];

/** Barème : tarifs annuels, coefficients par durée (1, 3, 6, 12 mois), frais fixe d'avenant. */
export interface CaarBareme {
  prices: Record<string, number>;
  coefs: number[];
  avFee: number;
}

/** Barème par défaut. */
export const DEFAULT_BAREME: CaarBareme = { prices: Object.fromEntries(CAAR_PRODUCTS.map((product) => [product.id, product.annual])), coefs: [0.25, 0.35, 0.55, 1], avFee: 200 };

/** Taux : part ALLO 47 %, avance 90 %, TVA 19 %. */
export const CAAR_RATES = { allo: 0.47, av: 0.9, tva: 0.19 } as const;

const BUCKETS: ReadonlyArray<{ max: number; label: string }> = [
  { max: 31, label: "1 mois" },
  { max: 92, label: "3 mois" },
  { max: 185, label: "6 mois" },
  { max: Number.POSITIVE_INFINITY, label: "12 mois" },
];

const norm = (value: unknown): string =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
const normHeader = (value: unknown): string => norm(value).replace(/[_\-'’.:°()/]/g, " ").replace(/\s+/g, " ").trim();
const isBlank = (value: SheetCell | undefined): boolean => value === null || value === undefined || (typeof value === "string" && value.trim() === "");
const isNA = (value: SheetCell | undefined): boolean => isBlank(value) || /^(na|n\/a|#n\/a|null|neant|0|-+|\.+|x+)$/i.test(String(value).trim());

function parseNumber(value: SheetCell | undefined): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (isBlank(value)) return null;
  let text = String(value).replace(/[\s  ]/g, "").replace(/da$/i, "");
  if (text.includes(",") && !text.includes(".")) text = text.replace(",", ".");
  else if (text.includes(",") && text.includes(".")) text = text.replace(/,/g, "");
  const parsed = Number(text);
  return Number.isFinite(parsed) && text !== "" ? parsed : null;
}

const ROLE_TESTS: ReadonlyArray<[string, (header: string) => boolean]> = [
  ["agence", (h) => /^(code )?agences?$|^code ag|^ag$|^n agence|^agence /.test(h)],
  ["nom", (h) => /^(nom|noms|assure|assuree|assures|client|raison sociale|souscripteur|nom assure|nom et prenom)\b/.test(h)],
  ["police", (h) => /police|^contrat|^n contrat/.test(h) && !/date|type/.test(h)],
  ["avenant", (h) => /avenant|^av$|^n av$/.test(h)],
  ["effet", (h) => /eff|debut|^du$/.test(h) && !/compta|emission|saisie/.test(h)],
  ["echeance", (h) => /eche|expir|^dt fin|^date fin|^fin$|^au$/.test(h)],
  ["immat", (h) => h.includes("immat") || h.includes("matric") || /^(n )?im+[aeiou]?[rt]/.test(h)],
  ["formule", (h) => /formule|^form$|^formul|^garantie$/.test(h)],
  ["codegar", (h) => /codegara|^code gar/.test(h)],
  ["etat", (h) => /^etat|^statut/.test(h)],
];
const CALC_RE = /47|90|tva|ttc|part|avance|allo|assisteur|%/;

type Columns = Record<string, number>;

function detectRoles(row: SheetCell[]): { cols: Columns; score: number } {
  const headers = row.map((cell) => (typeof cell === "string" ? normHeader(cell) : ""));
  const raw = row.map((cell) => (typeof cell === "string" ? norm(cell) : ""));
  const cols: Columns = {};
  for (const [role, test] of ROLE_TESTS) {
    cols[role] = -1;
    for (let index = 0; index < headers.length; index += 1) {
      if (headers[index] && test(headers[index] ?? "") && !Object.values(cols).includes(index)) {
        cols[role] = index;
        break;
      }
    }
  }
  const primeCandidates = headers.map((header, index) => ({ header, index, raw: raw[index] ?? "" })).filter((entry) => /prim/.test(entry.header) && !CALC_RE.test(entry.raw) && !/total/.test(entry.header));
  const prime = primeCandidates.find((entry) => /net/.test(entry.header)) ?? primeCandidates[0];
  cols.prime = prime ? prime.index : headers.findIndex((header, index) => /^(montant|mt) (assistance|prime)|^montant$/.test(header) && !CALC_RE.test(raw[index] ?? ""));
  return { cols, score: Object.values(cols).filter((value) => value >= 0).length };
}

function findHeader(rows: SheetCell[][]): { row: number; cols: Columns } | null {
  let best: { row: number; cols: Columns; score: number } | null = null;
  for (let index = 0; index < Math.min(rows.length, 40); index += 1) {
    const row = rows[index] ?? [];
    if (row.filter((cell) => typeof cell === "string" && cell.trim()).length < 3) continue;
    const { cols, score } = detectRoles(row);
    if ((cols.agence ?? -1) < 0 || (cols.prime ?? -1) < 0) continue;
    if ((cols.police ?? -1) < 0 && (cols.nom ?? -1) < 0 && (cols.immat ?? -1) < 0) continue;
    if (!best || score > best.score) best = { row: index, cols, score };
  }
  return best ? { row: best.row, cols: best.cols } : null;
}

/** Produit reconnu dans le libellé de formule ou le code garantie (règles de l'ancienne version). */
export function detectProduct(formule: string, codegar: string): string | null {
  const code = codegar.trim().toUpperCase();
  const byCode = code ? CAAR_PRODUCTS.find((product) => product.cg === code) : undefined;
  if (byCode) return byCode.id;
  const s = norm(formule).replace(/\s+/g, " ");
  if (!s) return null;
  if (/tunisie/.test(s)) return "TUNISIE";
  if (/\d{3,}[-.]\d{2,3}[-.]\d{2}|^t\d{6}|^[a-z]{2}\d{6}/.test(s)) return null;
  if (/lourd|\d[.,]?\d* ?t\b/.test(s)) {
    const reduced = /reduit/.test(s);
    if (/f0?1\b|3[.,]5/.test(s)) return reduced ? "L1R" : "L1";
    if (/f0?2\b|10 ?t/.test(s)) return reduced ? "L2R" : "L2";
    if (/f0?3\b|sup ?20|20 ?t/.test(s)) return reduced ? "L3R" : "L3";
    return null;
  }
  if (/pro ?-?assi|taxi/.test(s)) return /assi(st)? ?0?1\b|pro ?-?assi ?0?1\b/.test(s) ? "TAXI1" : "TAXI";
  if (/azur/.test(s) && /convention/.test(s)) return "AZURC";
  if (/convention/.test(s) || /^formule 3500/.test(s)) return "CONV";
  if (/clarte/.test(s)) return "CLAR";
  if (/lueur/.test(s)) return "LUEUR";
  if (/securite/.test(s)) return "SECU";
  if (/soleil/.test(s) || (/secteur/.test(s) && /\b2\b|200|25/.test(s))) return "SOL";
  if (/secteur/.test(s)) return "AZS";
  if (/azur/.test(s)) return "AZUR";
  if (/sonatrach|sontrach|\bsh\b|sh-|^sng$|f ?sh ?\d{0,4}$|formule ?sh/.test(s)) return "SH";
  const t = s.replace(/^(formules?|formula|formul|fomule|frmule|formile|formil|f0rule|formulr)\s*/, "f ").replace(/\s+/g, " ").trim();
  if (/^100$/.test(t)) return "F1";
  if (/200 ?k|^f ?[/-]? ?0?2\b|^2$|^f ?2|2\/200/.test(t)) return "F2";
  if (/100 ?k|100\/k|^f ?[/-]? ?0?1\b|^1$|^f ?1|1\/100/.test(t)) return "F1";
  if (/^f ?[/-]? ?0?3\b|^3$|^f ?3|territoir|\bt ?,? ?n\b|\btn\b/.test(t)) return "F3";
  if (/50 ?k|^f ?[/-]? ?0+\b|^0$|^f ?0|^f00|^formile0/.test(t)) return "F0";
  return null;
}

const near = (amount: number, expected: number): boolean => Math.abs(amount - expected) <= Math.max(1, Math.abs(expected) * 0.005);

/** Contrôle de la prime au barème (durée, prorata, avenant, flotte). */
function evaluatePrime(prime: number, product: string | null, days: number | null, avenant: boolean, fleetLike: boolean, bareme: CaarBareme): { status: "ok" | "prorata" | "flotte" | "ko" | "unknown" | "zero"; basis: string } {
  if (prime === 0) return { status: "zero", basis: "" };
  const p = Math.abs(prime);
  if (bareme.avFee > 0 && near(p, bareme.avFee)) return { status: "ok", basis: `${avenant ? "avenant" : "avenant probable"} · frais fixe ${bareme.avFee} DA` };
  if (!product) return { status: "unknown", basis: "" };
  const annual = bareme.prices[product] ?? 0;
  const bucket = days === null || days < 0 ? -1 : BUCKETS.findIndex((entry) => days <= entry.max);
  if (bucket >= 0 && days !== null) {
    const expected = annual * (bareme.coefs[bucket] ?? 1);
    if (near(p, expected)) return { status: "ok", basis: BUCKETS[bucket]?.label ?? "" };
    if (days > 0) for (const d of [days, days + 1, days + 0.5]) if (Math.abs(p - (annual * d) / 365) <= Math.max(1.5, ((annual * d) / 365) * 0.01)) return { status: "prorata", basis: `prorata ${Math.round(d)} j / 365` };
    if (near(p, annual)) return { status: "ok", basis: `${avenant ? "avenant" : fleetLike ? "flotte (même police)" : "palier différent de la durée"} · tarif annuel` };
    for (let index = BUCKETS.length - 1; index >= 0; index -= 1) if (near(p, annual * (bareme.coefs[index] ?? 1))) return { status: "ok", basis: `palier ${BUCKETS[index]?.label ?? ""}` };
    const k = Math.round(p / expected);
    if (k >= 2 && near(p, k * expected)) return { status: "flotte", basis: `${k} × ${BUCKETS[bucket]?.label ?? ""}` };
    return { status: "ko", basis: `${BUCKETS[bucket]?.label ?? ""} (${days} j) — attendu ${round2(expected)} DA` };
  }
  for (let index = BUCKETS.length - 1; index >= 0; index -= 1) if (near(p, annual * (bareme.coefs[index] ?? 1))) return { status: "ok", basis: `${BUCKETS[index]?.label ?? ""} (dates illisibles)` };
  const k = Math.round(p / annual);
  if (k >= 2 && near(p, k * annual)) return { status: "flotte", basis: `${k} × 12 mois` };
  return { status: "ko", basis: `durée inconnue — tarif annuel ${annual} DA` };
}

/** Ligne de production lue. */
export interface CaarRecord {
  line: number;
  agence: string;
  police: string;
  nom: string;
  immat: string;
  effet: string;
  echeance: string;
  formule: string;
  product: string | null;
  prime: number | null;
  include: boolean;
  flags: CaarFlag[];
  basis: string;
}

/** Résultat du contrôle d'un fichier de production. */
export interface CaarAnalysis {
  sheet: string;
  records: CaarRecord[];
  tcd: Array<[string, number, number]>;
  products: Array<[string, string, number, number, number]>;
  totals: { prime: number; allo: number; av: number; tva: number; ttc: number; n: number };
  stats: { lignes: number; retenues: number; excluded: number; kinds: Partial<Record<CaarFlag, number>> };
  declared: { prime: number; line: number } | null;
  period: { annee: number; mois: number } | null;
  succursale: string;
  message: string;
}

const MONTHS: ReadonlyArray<[RegExp, number]> = [
  [/janv/, 1],
  [/fevr|fev\b/, 2],
  [/mars/, 3],
  [/avri/, 4],
  [/\bmai\b/, 5],
  [/juin/, 6],
  [/juil/, 7],
  [/aout/, 8],
  [/sept/, 9],
  [/octo/, 10],
  [/nove/, 11],
  [/dece/, 12],
];
const BRANCHES = ["Cheraga", "Bouzareah", "Oran", "Constantine", "Annaba"];

/** Période et succursale déduites du nom du fichier (« CAAR SEPTEMBRE CONSTANTINE.xlsx »). */
export function detectFromFileName(fileName: string, fallbackYear: number): { period: { annee: number; mois: number } | null; succursale: string } {
  const text = norm(fileName);
  const month = MONTHS.find(([pattern]) => pattern.test(text))?.[1] ?? null;
  const year = Number(text.match(/20\d\d/)?.[0] ?? fallbackYear);
  const succursale = BRANCHES.find((branch) => text.includes(norm(branch)) || (branch === "Bouzareah" && /bouzar/.test(text)) || (branch === "Cheraga" && /cherag/.test(text))) ?? "";
  return { period: month ? { annee: year, mois: month } : null, succursale };
}

/**
 * Contrôle d'un fichier de production CAAR d'une succursale : colonnes reconnues automatiquement,
 * anomalies (agence, police, prime, immatriculation, doublons, barème), TCD par agence, totaux part ALLO 47 % / avance 90 % / TVA,
 * comparaison au total déclaré et message prêt à envoyer à la succursale.
 */
export function analyseCaarWorkbook(sheets: SheetData[], fileName: string, bareme: CaarBareme, fallbackYear: number): CaarAnalysis | null {
  let picked: { sheet: SheetData; header: { row: number; cols: Columns } } | null = null;
  for (const sheet of sheets) {
    const header = findHeader(sheet.rows);
    if (header && (!picked || sheet.rows.length > picked.sheet.rows.length)) picked = { sheet, header };
  }
  if (!picked) return null;
  const { sheet, header } = picked;
  const col = (row: SheetCell[], role: string): SheetCell | undefined => {
    const index = header.cols[role] ?? -1;
    return index >= 0 ? row[index] : undefined;
  };
  const records: CaarRecord[] = [];
  let declared: CaarAnalysis["declared"] = null;
  const headerText = normHeader((sheet.rows[header.row] ?? [])[header.cols.agence ?? 0]);
  for (let index = header.row + 1; index < sheet.rows.length; index += 1) {
    const row = sheet.rows[index] ?? [];
    if (row.every((cell) => isBlank(cell))) continue;
    const agenceRaw = col(row, "agence");
    const flags: CaarFlag[] = [];
    const lineText = norm(row.filter((cell) => typeof cell === "string").join(" "));
    const prime = parseNumber(col(row, "prime"));
    if (/\btotal\b|^somme/.test(lineText) && isNA(col(row, "police"))) {
      flags.push("TOTAL");
      if (prime !== null) declared = { prime, line: index + 1 };
    } else if (normHeader(agenceRaw) === headerText && headerText) {
      flags.push("HEADER");
    }
    const formule = String(col(row, "formule") ?? "");
    const product = detectProduct(formule, String(col(row, "codegar") ?? ""));
    const effet = parseLooseDate(col(row, "effet"));
    const echeance = parseLooseDate(col(row, "echeance"));
    const record: CaarRecord = {
      line: index + 1,
      agence: isNA(agenceRaw) ? "" : String(typeof agenceRaw === "number" ? Math.round(agenceRaw) : agenceRaw).trim(),
      police: isNA(col(row, "police")) ? "" : String(col(row, "police")).trim(),
      nom: isNA(col(row, "nom")) ? "" : String(col(row, "nom")).trim(),
      immat: isNA(col(row, "immat")) ? "" : String(col(row, "immat")).trim(),
      effet,
      echeance,
      formule,
      product,
      prime,
      include: flags.length === 0,
      flags,
      basis: "",
    };
    if (record.include) {
      if (!record.agence) flags.push("AG_MISSING");
      if (!record.police && (header.cols.police ?? -1) >= 0) flags.push("POL_MISSING");
      if (prime === null) flags.push("PRIME_MISSING");
      if (!record.immat && (header.cols.immat ?? -1) >= 0) flags.push("IMM_MISSING");
      if (!record.nom && (header.cols.nom ?? -1) >= 0) flags.push("NOM_MISSING");
      if (effet && echeance && echeance < effet) flags.push("DATE_ORDER");
      if (/annul|non encaiss|impay/.test(norm(col(row, "etat")))) flags.push("ETAT_KO");
      if (product === "TUNISIE") {
        flags.push("TUNISIE");
        record.include = false;
      }
      if (prime !== null && prime < 0) flags.push("PRIME_NEG");
    }
    records.push(record);
  }
  const policyCount = new Map<string, number>();
  for (const record of records) if (record.include && record.police) policyCount.set(record.police, (policyCount.get(record.police) ?? 0) + 1);
  const seen = new Set<string>();
  const hasFormula = (header.cols.formule ?? -1) >= 0 || (header.cols.codegar ?? -1) >= 0;
  for (const record of records) {
    if (!record.include || record.prime === null) continue;
    const key = `${record.police}|${record.immat}|${record.effet}|${record.prime}`;
    if (record.police && seen.has(key)) record.flags.push("DUP");
    seen.add(key);
    const days = record.effet && record.echeance ? Math.round((Date.parse(record.echeance) - Date.parse(record.effet)) / 86_400_000) : null;
    const evaluation = evaluatePrime(record.prime, record.product, days, false, (policyCount.get(record.police) ?? 0) >= 2, bareme);
    record.basis = evaluation.basis;
    if (evaluation.status === "ko") record.flags.push("PRIME_KO");
    else if (evaluation.status === "unknown" && hasFormula) record.flags.push("PROD_UNK");
    else if (evaluation.status === "zero") record.flags.push("PRIME_ZERO");
    else if (evaluation.status === "flotte") record.flags.push("PRIME_FLOTTE");
  }
  const retained = records.filter((record) => record.include && record.prime !== null);
  const byAgency = new Map<string, { n: number; prime: number }>();
  for (const record of retained) {
    const entry = byAgency.get(record.agence || "?") ?? { n: 0, prime: 0 };
    entry.n += 1;
    entry.prime = round2(entry.prime + (record.prime ?? 0));
    byAgency.set(record.agence || "?", entry);
  }
  const tcd = [...byAgency.entries()].sort((a, b) => a[0].localeCompare(b[0], "fr", { numeric: true })).map(([agence, entry]) => [agence, entry.n, entry.prime] as [string, number, number]);
  const byProduct = new Map<string, { n: number; prime: number; ko: number }>();
  for (const record of retained) {
    const key = record.product ?? "?";
    const entry = byProduct.get(key) ?? { n: 0, prime: 0, ko: 0 };
    entry.n += 1;
    entry.prime = round2(entry.prime + (record.prime ?? 0));
    if (record.flags.includes("PRIME_KO")) entry.ko += 1;
    byProduct.set(key, entry);
  }
  const products = [...byProduct.entries()].map(([id, entry]) => [id, CAAR_PRODUCTS.find((product) => product.id === id)?.label ?? "Non reconnu", entry.n, entry.prime, entry.ko] as [string, string, number, number, number]);
  const prime = round2(retained.reduce((sum, record) => sum + (record.prime ?? 0), 0));
  const allo = round2(prime * CAAR_RATES.allo);
  const av = round2(allo * CAAR_RATES.av);
  const tva = round2(av * CAAR_RATES.tva);
  const kinds: Partial<Record<CaarFlag, number>> = {};
  for (const record of records) for (const flag of record.flags) kinds[flag] = (kinds[flag] ?? 0) + 1;
  const detected = detectFromFileName(fileName, fallbackYear);
  const askable = (Object.keys(kinds) as CaarFlag[]).filter((flag) => CAAR_FLAGS[flag].ask);
  const parts = askable.map((flag) => {
    const lines = records.filter((record) => record.flags.includes(flag)).map((record) => record.line);
    const shown = lines.slice(0, 12).join(", ");
    return `- ${CAAR_FLAGS[flag].ask} : ${lines.length} ligne${lines.length > 1 ? "s" : ""} (ligne${lines.length > 1 ? "s" : ""} ${shown}${lines.length > 12 ? "…" : ""})`;
  });
  if (kinds.TOTAL) parts.push(`- Lignes de total ou d'en-tête recopiées dans les données : ligne(s) ${records.filter((record) => record.flags.includes("TOTAL")).map((record) => record.line).join(", ")}. Merci d'envoyer uniquement les lignes de détail, sans totaux.`);
  const message = parts.length
    ? `Bonjour,\n\nAprès contrôle du fichier « ${fileName.replace(/\.(xlsx|xls|xlsm|csv)$/i, "")} », merci de corriger les points suivants :\n\n${parts.join("\n")}\n\nCordialement.`
    : `Bonjour,\n\nLe fichier « ${fileName.replace(/\.(xlsx|xls|xlsm|csv)$/i, "")} » a été contrôlé : aucune anomalie bloquante.\n\nCordialement.`;
  return {
    sheet: sheet.name,
    records,
    tcd,
    products,
    totals: { prime, allo, av, tva, ttc: round2(av + tva), n: retained.length },
    stats: { lignes: records.length, retenues: retained.length, excluded: records.length - retained.length, kinds },
    declared,
    period: detected.period,
    succursale: detected.succursale,
    message,
  };
}
