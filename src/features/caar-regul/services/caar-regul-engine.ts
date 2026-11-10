import { REGUL_MOIS } from "@/features/regul/services/regul-engine";
import type { SheetCell, SheetData } from "@/lib/spreadsheet";

/* Régularisation du complément 10 % des succursales CAAR.
   Montants HT : part ALLO = 47 % de la prime HT. Écart = production régularisée − avance 90 % HT ; TVA 19 % sur l'écart seulement
   (l'avance a été réglée TTC). Partenariat depuis mai 2026 ; à partir de 2027, régularisation trimestre par trimestre. */

/** Succursales CAAR suivies. */
export const CAAR_SUCCURSALES = ["CHERAGA", "BOUZAREAH", "CONSTANTINE", "ANNABA", "ORAN"] as const;

/** Code d'une succursale CAAR. */
export type CaarSucc = (typeof CAAR_SUCCURSALES)[number];

/** Libellés affichés des succursales. */
export const CAAR_LABELS: Readonly<Record<CaarSucc, string>> = { CHERAGA: "Alger Chéraga", BOUZAREAH: "Alger Bouzaréah", CONSTANTINE: "Constantine", ANNABA: "Annaba", ORAN: "Oran" };

/** Premier mois du partenariat (AAAAMM). */
export const CAAR_DEBUT = 202605;

/** Taux : part ALLO et TVA. */
export const CAAR_TAUX = { allo: 0.47, tva: 0.19 } as const;

/** Trimestres (à partir de 2027). */
export const CAAR_TRIMESTRES: Readonly<Record<"T1" | "T2" | "T3" | "T4", readonly number[]>> = { T1: [1, 2, 3], T2: [4, 5, 6], T3: [7, 8, 9], T4: [10, 11, 12] };

/** Clé de trimestre. */
export type Trimestre = keyof typeof CAAR_TRIMESTRES;

/** Ligne de la production facturée à l'avance (consolidé) :
 * [mois AAAAMM, agence, assuré, police, date d'effet ISO, immatriculation, index de formule, incluse 1/0, prime facturée, prime d'origine, part ALLO 47 %, motif d'exclusion]. */
export type CaarBaseRow = [number, string, string, string, string, string, number, number, number, number, number, number];

/** Facture d'avance d'un mois (onglet RECAP FACTURES). */
export interface CaarFacture {
  fact: string;
  ttc: number;
  date: string;
  etat: string;
}

/** Totaux d'un mois du consolidé. */
export interface CaarMoisBase {
  n: number;
  nIncl: number;
  allo: number;
  p90: number;
}

/** Index de la base : formules, totaux mensuels, factures d'avance. */
export interface CaarRegulIndex {
  forms: string[];
  mois: Record<string, Record<string, CaarMoisBase>>;
  factures: Record<string, Record<string, CaarFacture>>;
  lignes: Record<string, number>;
  maj: string;
  source: string;
}

/** Base activité : clés « police | immatriculation » des dossiers CAAR. */
export interface CaarRegulSin {
  keys: string[];
  jusqua: string;
  dossiers: number;
  maj: string;
}

/** Avance saisie à la main pour un mois. */
export interface CaarSaisie {
  succ: string;
  avance?: number;
}

/** Résultat enregistré d'un mois régularisé. */
export interface CaarRegulSaved {
  succ: string;
  ym: number;
  annee: number;
  mois: number;
  total: number;
  avance: number;
  regule: number;
  ecart: number;
  tva: number;
  pa: number;
  fact: string;
  top: string;
  fichiers: string[];
  maj: string;
}

/** Ligne d'un fichier de production renvoyé par la succursale. */
export interface ProdLine {
  agence: string;
  assure: string;
  police: string;
  pb: string;
  avenant: string;
  de: string;
  immat: string;
  formule: string;
  prime: number;
  etat: string;
  src: "fichier" | "liste";
}

/** Onglet lu dans un fichier de production. */
export interface ProdLot {
  id: string;
  name: string;
  sheet: string;
  ym: number;
  ignore: boolean;
  avant: boolean;
  lignes: ProdLine[];
  liste: ProdLine[];
}

/* ---------- utilitaires ---------- */

const r2 = (n: number): number => Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
const pad = (n: number): string => String(n).padStart(2, "0");

/** Texte en majuscules sans accents. */
export const txt = (v: unknown): string =>
  String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase();

/** Code AAAAMM. */
export const ym = (y: number, m: number): number => y * 100 + m;

/** Clé « AAAA-MM ». */
export const ymKey = (v: number): string => `${Math.floor(v / 100)}-${pad(v % 100)}`;

/** « Mai 2026 ». */
export const ymLabel = (v: number): string => `${REGUL_MOIS[(v % 100) - 1] ?? ""} ${Math.floor(v / 100)}`;

const COURTS = ["Janv.", "Févr.", "Mars", "Avr.", "Mai", "Juin", "Juil.", "Août", "Sept.", "Oct.", "Nov.", "Déc."];
/** « Juil. 2026 ». */
export const ymShort = (v: number): string => `${COURTS[(v % 100) - 1] ?? ""} ${Math.floor(v / 100)}`;

/** Trimestre d'un mois AAAAMM. */
export const trimestreOf = (v: number): Trimestre => `T${Math.ceil((v % 100) / 3)}` as Trimestre;

/** Mois AAAAMM d'un trimestre. */
export const monthsOfTrimestre = (y: number, t: Trimestre): number[] => CAAR_TRIMESTRES[t].map((m) => ym(y, m));

/** Succursale reconnue dans un libellé ou un nom de fichier. */
export function caarSucc(raw: unknown): CaarSucc | "" {
  const t = txt(raw).replace(/[^A-Z0-9]/g, " ");
  if (/BOUZAR/.test(t)) return "BOUZAREAH";
  if (/CHERAGA/.test(t)) return "CHERAGA";
  if (/CONSTANTINE/.test(t)) return "CONSTANTINE";
  if (/ANNABA/.test(t)) return "ANNABA";
  if (/\bORAN\b/.test(t)) return "ORAN";
  return "";
}

const MOIS_NOMS: ReadonlyArray<[string, number]> = [["JANV", 1], ["FEV", 2], ["MARS", 3], ["AVR", 4], ["MAI", 5], ["JUIN", 6], ["JUIL", 7], ["AOUT", 8], ["SEPT", 9], ["OCT", 10], ["NOV", 11], ["DEC", 12]];

/** Mois et année lus dans un texte (« MAI 2026 », nom d'onglet ou de fichier). */
export function monthInText(raw: string): { m: number; y: number } | null {
  const t = txt(raw);
  for (const [p, m] of MOIS_NOMS) {
    if (t.includes(p)) {
      const y = /(20\d\d)/.exec(t);
      return { m, y: y?.[1] ? Number(y[1]) : 0 };
    }
  }
  return null;
}

/** Police sans avenant ni espaces. */
export const policeBase = (p: unknown): string =>
  String(p ?? "")
    .trim()
    .replace(/\.0+$/, "")
    .split("/")[0]
    ?.replace(/\s/g, "")
    .toUpperCase() ?? "";

/** Code agence normalisé (« 407-1 » → « 4071 »). */
export const agenceCode = (a: unknown): string =>
  String(a ?? "")
    .trim()
    .replace(/\.0+$/, "")
    .replace(/[^0-9A-Za-z]/g, "")
    .toUpperCase();

/** Immatriculation normalisée. */
export const immatNorm = (v: string): string => v.replace(/[ \-.]/g, "").toUpperCase();

const nomNorm = (s: string): string => txt(s).replace(/[^A-Z]/g, "");

/** Formule « Assistance TUNISIE » (hors convention : toujours 0 DA). */
export const isTunisie = (f: string): boolean => /TUNISIE/.test(txt(f));

/** Montant lu dans une cellule. */
export function amount(c: SheetCell | undefined): number {
  if (typeof c === "number") return c;
  if (c === null || c === undefined || typeof c === "boolean" || c instanceof Date) return 0;
  const v = parseFloat(c.replace(/\s/g, "").replace(",", "."));
  return Number.isNaN(v) ? 0 : v;
}

/** Date ISO (AAAA-MM-JJ) lue dans une cellule (date, numéro de série Excel ou texte JJ/MM/AAAA). */
export function isoDate(c: SheetCell | undefined): string {
  if (c instanceof Date && !Number.isNaN(c.getTime())) return `${c.getUTCFullYear()}-${pad(c.getUTCMonth() + 1)}-${pad(c.getUTCDate())}`;
  if (typeof c === "number" && c > 20000 && c < 80000) {
    const d = new Date(Math.round((c - 25569) * 864e5));
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  const t = String(c ?? "").trim().split(/\s+/)[0] ?? "";
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (iso) return iso[0];
  const fr = /^(\d{1,2})[/,.-](\d{1,2})[/,.-](\d{4})$/.exec(t);
  return fr ? `${fr[3]}-${pad(Number(fr[2]))}-${pad(Number(fr[1]))}` : "";
}

const cellStr = (c: SheetCell | undefined): string => (c === null || c === undefined ? "" : c instanceof Date ? isoDate(c) : String(c).trim());

/* ---------- lecture des fichiers de production ---------- */

type Col = "agence" | "assure" | "police" | "avenant" | "de" | "immat" | "formule" | "prime" | "etat";
const HEADERS: Readonly<Record<Col, RegExp>> = {
  agence: /^(CODE.?)?AGENCE$/,
  assure: /^ASSURE$|^CLIENT$|^NOM/,
  police: /^(N.?\s*)?POLICE$/,
  avenant: /^AVEN/,
  de: /DATE.?(D.?)?EFFET|DATE.?DEBUT/,
  immat: /IMMAT/,
  formule: /^FORMULE$|^PRODUIT$/,
  prime: /^PRIME/,
  etat: /^ETAT$/,
};

function headerMap(row: ReadonlyArray<SheetCell>): Record<Col, number> | null {
  const h = row.map((c) => txt(c).trim());
  const ix = {} as Record<Col, number>;
  for (const k of Object.keys(HEADERS) as Col[]) ix[k] = h.findIndex((c) => c !== "" && HEADERS[k].test(c));
  return ix.police >= 0 && ix.prime >= 0 ? ix : null;
}

function readBlock(rows: ReadonlyArray<ReadonlyArray<SheetCell>>, hi: number, ix: Record<Col, number>, src: ProdLine["src"]): { lignes: ProdLine[]; fin: number } {
  const out: ProdLine[] = [];
  let i = hi + 1;
  for (; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const g = (k: Col): SheetCell | undefined => (ix[k] >= 0 ? r[ix[k]] : undefined);
    const pol = cellStr(g("police"));
    if (!pol || !/\d/.test(pol)) {
      if (out.length) break;
      continue;
    }
    out.push({
      agence: agenceCode(g("agence")),
      assure: cellStr(g("assure")),
      police: pol.replace(/\.0+$/, ""),
      pb: policeBase(pol),
      avenant: cellStr(g("avenant")),
      de: isoDate(g("de")),
      immat: cellStr(g("immat")),
      formule: cellStr(g("formule")),
      prime: amount(g("prime")),
      etat: cellStr(g("etat")),
      src,
    });
  }
  return { lignes: out, fin: i };
}

/** Lit les onglets d'un fichier de production : bloc principal sous l'en-tête, puis listes « polices exclues » placées sous le total. */
export function parseProdFile(name: string, size: number, sheets: ReadonlyArray<SheetData>): ProdLot[] {
  const parsed: Array<{ sheet: string; lignes: ProdLine[]; liste: ProdLine[]; sm: { m: number; y: number } | null }> = [];
  for (const sh of sheets) {
    const rows = sh.rows;
    let hi = -1;
    let ix: Record<Col, number> | null = null;
    for (let i = 0; i < Math.min(rows.length, 40); i++) {
      const m = headerMap(rows[i] ?? []);
      if (m) {
        hi = i;
        ix = m;
        break;
      }
    }
    if (hi < 0 || !ix) continue;
    const main = readBlock(rows, hi, ix, "fichier");
    if (!main.lignes.length) continue;
    const liste: ProdLine[] = [];
    for (let i = main.fin; i < rows.length; i++) {
      const m = headerMap(rows[i] ?? []);
      if (!m) continue;
      const b = readBlock(rows, i, m, "liste");
      liste.push(...b.lignes);
      i = b.fin;
    }
    parsed.push({ sheet: sh.name, lignes: main.lignes, liste, sm: monthInText(sh.name) });
  }
  const fm = monthInText(name);
  const withMonth = parsed.some((p) => p.sm);
  return parsed.map((p) => {
    let mt = p.sm;
    let ignore = false;
    if (!mt) {
      if (withMonth) ignore = true;
      else mt = fm;
    }
    const top = (len: number): string => {
      const cnt = new Map<string, number>();
      for (const l of p.lignes) {
        const k = l.de.slice(0, len);
        if (k) cnt.set(k, (cnt.get(k) ?? 0) + 1);
      }
      return [...cnt.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
    };
    if (!mt && !ignore) {
      const k = top(7);
      if (k) mt = { y: Number(k.slice(0, 4)), m: Number(k.slice(5, 7)) };
    }
    let y = mt?.y ?? 0;
    if (mt && !y) y = Number(top(4)) || 2026;
    const v = mt && !ignore ? ym(y, mt.m) : 0;
    const avant = v > 0 && v < CAAR_DEBUT;
    return { id: `${name}|${p.sheet}|${size}`, name, sheet: p.sheet, ym: v, ignore: ignore || avant, avant, lignes: p.lignes, liste: p.liste };
  });
}

/* ---------- analyse ---------- */

/** Ligne de production analysée. */
export interface LineA extends ProdLine {
  ym: number;
  fichier: string;
  feuille: string;
  im: string;
  compte: boolean;
  allo: number;
  motif: string;
  reprise: boolean;
}

/** Situation d'une police en écart. */
export type Situation = "Nouvelle police" | "Police réintégrée" | "Montant modifié" | "Police retirée" | "N° de police corrigé";

/** Ordre d'affichage des situations. */
export const SITUATIONS: readonly Situation[] = ["Nouvelle police", "Police réintégrée", "Montant modifié", "Police retirée", "N° de police corrigé"];

/** Police en écart (montants en part ALLO 47 % HT). */
export interface EcartPolice {
  ym: number;
  pb: string;
  ag: string;
  as: string;
  aN: number;
  aC: number;
  d: number;
  sit: Situation;
  ex: string;
  liste: boolean;
}

/** Comparaison d'une agence pour un mois. */
export interface AgenceRow {
  a: string;
  nB: number;
  nF: number;
  aB: number;
  aF: number;
  d: number;
  statut: "ANOMALIE" | "OK" | "OK (flotte regroupée)";
  expl: string;
}

/** Police Tunisie trouvée avec un montant. */
export interface TunisieRow {
  ou: "fichier" | "avance";
  ym: number;
  agence: string;
  assure: string;
  police: string;
  de: string;
  immat: string;
  formule: string;
  montant: number;
}

/** Résultat de l'analyse d'une succursale sur une période. */
export interface CaarAnalysis {
  s: CaarSucc;
  months: number[];
  lots: ProdLot[];
  L: LineA[];
  C: LineA[];
  nonEnc: LineA[];
  liste: LineA[];
  tunisie: TunisieRow[];
  ecarts: EcartPolice[];
  agTab: Record<number, AgenceRow[]>;
  agMap: Record<string, string>;
  annul: Array<LineA & { sinistre: boolean | null; plus: boolean }>;
  garan: Array<LineA & { autres: string }>;
  regule: Record<number, number>;
  total: Record<number, number>;
  baseN: number;
}

/** Rapproche les fichiers de la succursale de la production facturée à l'avance. */
export function analyse(s: CaarSucc, months: readonly number[], lots: readonly ProdLot[], base: readonly CaarBaseRow[], forms: readonly string[], sin: Set<string> | null): CaarAnalysis {
  const ms = [...months].sort((a, b) => a - b);
  const used = lots.filter((f) => !f.ignore && ms.includes(f.ym));
  const L: LineA[] = [];
  const nonEnc: LineA[] = [];
  const liste: LineA[] = [];
  const tunisie: TunisieRow[] = [];
  for (const f of used) {
    const seen = new Map<string, number>();
    for (const l of f.lignes) seen.set(`${l.pb}|${l.de}`, (seen.get(`${l.pb}|${l.de}`) ?? 0) + 1);
    const add = (l: ProdLine, reprise: boolean): void => {
      const x: LineA = { ...l, ym: f.ym, fichier: f.name, feuille: f.sheet, im: immatNorm(l.immat), compte: true, allo: 0, motif: "", reprise };
      if (isTunisie(x.formule)) {
        x.compte = false;
        if (Math.abs(x.prime) > 0.004) {
          x.motif = `Formule Assistance TUNISIE avec un montant (${r2(x.prime)} DA) : doit être à 0, ramenée à 0 DA`;
          tunisie.push({ ou: "fichier", ym: x.ym, agence: x.agence, assure: x.assure, police: x.police, de: x.de, immat: x.immat, formule: x.formule, montant: x.prime });
        }
      } else if (x.etat && !/ENCAISS/.test(txt(x.etat))) {
        x.compte = false;
        x.motif = `Quittance non encaissée (état : ${x.etat})`;
        nonEnc.push(x);
      }
      x.allo = x.compte ? x.prime * CAAR_TAUX.allo : 0;
      L.push(x);
      if (reprise) liste.push(x);
    };
    for (const l of f.lignes) add(l, false);
    for (const l of f.liste) {
      const k = `${l.pb}|${l.de}`;
      const n = seen.get(k) ?? 0;
      if (n > 0) {
        seen.set(k, n - 1);
        continue;
      }
      add(l, true);
    }
  }
  const C = L.filter((x) => x.compte);
  const B = base
    .filter((r) => ms.includes(r[0]))
    .map((r) => ({ ym: r[0], agence: r[1], assure: r[2], pb: r[3], de: r[4], immat: r[5], formule: forms[r[6]] ?? "", incl: r[7] === 1, primeF: r[8], allo: r[10], motif: r[11], ag: r[1] }));
  const BI = B.filter((b) => b.incl);
  const BX = B.filter((b) => !b.incl);
  for (const b of BI) {
    if (isTunisie(b.formule) && Math.abs(b.allo) > 0.004) tunisie.push({ ou: "avance", ym: b.ym, agence: b.agence, assure: b.assure, police: b.pb, de: b.de, immat: b.immat, formule: b.formule, montant: b.allo });
  }
  const fCodes = new Set(C.map((x) => x.agence));
  const agMap: Record<string, string> = {};
  for (const c of new Set(B.map((b) => b.agence))) {
    if (fCodes.has(c)) continue;
    const cand = [...fCodes].filter((f) => f.endsWith(c) && f !== c);
    if (cand.length === 1 && cand[0]) agMap[c] = cand[0];
  }
  for (const b of B) b.ag = agMap[b.agence] ?? b.agence;
  interface Acc { ym: number; pb: string; nN: number; nC: number; aN: number; aC: number; pC: number; ag: string; as: string; liste: boolean }
  const pol = new Map<string, Acc>();
  const get = (y: number, pb: string): Acc => {
    const k = `${y}|${pb}`;
    let o = pol.get(k);
    if (!o) {
      o = { ym: y, pb, nN: 0, nC: 0, aN: 0, aC: 0, pC: 0, ag: "", as: "", liste: false };
      pol.set(k, o);
    }
    return o;
  };
  for (const x of C) {
    const o = get(x.ym, x.pb);
    o.nN++;
    o.aN += x.allo;
    o.ag ||= x.agence;
    o.as ||= x.assure;
    if (x.reprise) o.liste = true;
  }
  for (const b of BI) {
    const o = get(b.ym, b.pb);
    o.nC++;
    o.aC += b.allo;
    o.pC += b.primeF;
    o.ag ||= b.ag;
    o.as ||= b.assure;
  }
  const exMot = new Map(BX.map((b) => [`${b.ym}|${b.pb}`, b.motif]));
  const ecarts: EcartPolice[] = [];
  for (const o of pol.values()) {
    const aN = r2(o.aN);
    const aC = r2(o.aC);
    const d = r2(aN - aC);
    if (Math.abs(d) < 0.5) continue;
    const exclu = exMot.has(`${o.ym}|${o.pb}`) || o.liste;
    const mo = exMot.get(`${o.ym}|${o.pb}`);
    let sit: Situation;
    if (o.nC === 0) sit = exclu ? "Police réintégrée" : "Nouvelle police";
    else if (o.nN === 0) sit = "Police retirée";
    else sit = exclu && d > 0 ? "Police réintégrée" : "Montant modifié";
    let ex: string;
    if (sit === "Police réintégrée") ex = o.liste || mo === 1 ? "Date d'effet antérieure au mois : exclue de l'avance, réintégrée (prime à encaisser)" : mo === 2 ? "Quittance impayée lors de l'avance, encaissée depuis" : "Exclue de l'avance, comptée dans la régule";
    else if (sit === "Nouvelle police") ex = "Absente de l'avance";
    else if (sit === "Police retirée") ex = "Absente du fichier de la succursale";
    else if (aC === 0) ex = "Facturée à 0 DA dans l'avance";
    else if (aN === 0) ex = "Prime à 0 DA dans le fichier";
    else if (Math.abs(r2(o.pC) - aN) < 0.05) ex = "Erreur dans l'avance : 47 % appliqué deux fois";
    else ex = "Prime différente";
    ecarts.push({ ym: o.ym, pb: o.pb, ag: o.ag, as: o.as, aN, aC, d, sit, ex, liste: o.liste });
  }
  for (const y of ms) {
    const moins = ecarts.filter((e) => e.ym === y && e.sit === "Police retirée");
    const paired = new Set<EcartPolice>();
    for (const p of ecarts.filter((e) => e.ym === y && e.sit === "Nouvelle police")) {
      const q = moins.find((m) => !paired.has(m) && nomNorm(m.as) === nomNorm(p.as) && Math.abs(m.aC - p.aN) < 0.05);
      if (!q) continue;
      paired.add(q);
      p.sit = "N° de police corrigé";
      q.sit = "N° de police corrigé";
      p.ex = `Même assuré et même montant, n° ${q.pb} dans l'avance : sans impact`;
      q.ex = `N° corrigé en ${p.pb} dans le fichier : sans impact`;
    }
  }
  const agM = new Map<string, AgenceRow>();
  const ag = (y: number, a: string): AgenceRow => {
    const k = `${y}|${a}`;
    let o = agM.get(k);
    if (!o) {
      o = { a, nB: 0, nF: 0, aB: 0, aF: 0, d: 0, statut: "OK", expl: "" };
      agM.set(k, o);
    }
    return o;
  };
  for (const b of BI) {
    const o = ag(b.ym, b.ag);
    o.nB++;
    o.aB += b.allo;
  }
  for (const x of C) {
    const o = ag(x.ym, x.agence);
    o.nF++;
    o.aF += x.allo;
  }
  const libSit: Readonly<Record<Situation, string>> = { "Nouvelle police": "nouvelle(s)", "Police réintégrée": "réintégrée(s)", "Montant modifié": "à montant modifié", "Police retirée": "retirée(s)", "N° de police corrigé": "corrigée(s)" };
  const sgn = (v: number): string => `${v > 0 ? "+" : ""}${Math.round(v).toLocaleString("fr-FR")}`;
  const agTab: Record<number, AgenceRow[]> = {};
  for (const y of ms) {
    const list: AgenceRow[] = [];
    for (const [k, o] of agM) {
      if (!k.startsWith(`${y}|`)) continue;
      o.aB = r2(o.aB);
      o.aF = r2(o.aF);
      o.d = r2(o.aF - o.aB);
      o.statut = Math.abs(o.d) >= 1 ? "ANOMALIE" : o.nB !== o.nF ? "OK (flotte regroupée)" : "OK";
      if (o.nF === 0 && o.nB > 0) o.expl = `Agence absente du fichier de la succursale : ${o.nB} ligne(s) facturée(s) dans l'avance (${r2(o.aB).toLocaleString("fr-FR")} DA). À faire confirmer`;
      else if (o.statut === "ANOMALIE") {
        const E = ecarts.filter((e) => e.ym === y && e.ag === o.a && e.sit !== "N° de police corrigé");
        const parts: string[] = [];
        for (const sit of SITUATIONS.slice(0, 4)) {
          const h = E.filter((e) => e.sit === sit).sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
          const first = h[0];
          if (!first) continue;
          const sd = r2(h.reduce((a, e) => a + e.d, 0));
          const detail = h.length === 1 ? ` : ${first.as.trim()}` : Math.abs(first.d) >= 0.5 * Math.abs(sd) ? `, surtout ${first.as.trim()} (${sgn(first.d)})` : "";
          parts.push(`${h.length} ${libSit[sit]} (${sgn(sd)})${detail}`);
        }
        o.expl = parts.join(" ; ");
      }
      list.push(o);
    }
    agTab[y] = list.sort((a, b) => a.a.length - b.a.length || (a.a < b.a ? -1 : 1));
  }
  const byIm = new Map<string, LineA[]>();
  for (const x of L) if (x.im) byIm.set(x.im, [...(byIm.get(x.im) ?? []), x]);
  const annul: CaarAnalysis["annul"] = [];
  const garan: CaarAnalysis["garan"] = [];
  for (const x of C) {
    if (x.prime >= 0) continue;
    const same = byIm.get(x.im) ?? [];
    const forms2 = new Set(same.map((y) => txt(y.formule)));
    if (x.im && forms2.size > 1) garan.push({ ...x, autres: [...new Set(same.map((y) => y.formule))].filter((f) => f !== x.formule).join(", ") });
    else annul.push({ ...x, sinistre: sin ? sin.has(`${x.pb}|${x.im}`) : null, plus: C.some((y) => y.prime > 0 && y.pb === x.pb && y.im === x.im) });
  }
  const regule: Record<number, number> = {};
  const total: Record<number, number> = {};
  for (const y of ms) {
    regule[y] = r2(C.filter((x) => x.ym === y).reduce((a, x) => a + x.allo, 0));
    total[y] = r2(BI.filter((b) => b.ym === y).reduce((a, b) => a + b.allo, 0));
  }
  return { s, months: ms, lots: used, L, C, nonEnc, liste, tunisie, ecarts, agTab, agMap, annul, garan, regule, total, baseN: B.length };
}

/* ---------- calcul ---------- */

/** Ligne du calcul (un mois). */
export interface CaarCalcRow {
  ym: number;
  key: string;
  total: number;
  avance: number;
  regule: number;
  complement: number;
  prod: number;
  ecart: number;
  tva: number;
  pa: number;
  fact: string;
  ttc: number | null;
  sansFacture: boolean;
  edited: boolean;
  hasFile: boolean;
}

/** Totaux du calcul. */
export interface CaarCalcTot {
  total: number;
  avance: number;
  regule: number;
  complement: number;
  prod: number;
  ecart: number;
  tva: number;
  pa: number;
}

/** Clé d'une saisie ou d'un résultat : « ORAN-2026-05 ». */
export const saisieKey = (s: string, v: number): string => `${s}-${ymKey(v)}`;

/** Avance HT d'un mois : saisie à la main, sinon facture d'avance TTC ÷ 1,19, sinon Part Assisteur 90 % du consolidé. */
export function avanceOf(s: CaarSucc, v: number, idx: CaarRegulIndex | null, saisies: Readonly<Record<string, CaarSaisie>>): { key: string; avance: number; fact: string; ttc: number | null; sansFacture: boolean; edited: boolean } {
  const key = saisieKey(s, v);
  const f = idx?.factures[s]?.[ymKey(v)];
  const mo = idx?.mois[s]?.[ymKey(v)];
  const base = f ? r2(f.ttc / (1 + CAAR_TAUX.tva)) : (mo?.p90 ?? 0);
  const sv = saisies[key];
  const edited = sv?.avance !== undefined;
  return { key, avance: edited && sv?.avance !== undefined ? sv.avance : base, fact: f?.fact ?? "", ttc: f ? f.ttc : null, sansFacture: !f, edited };
}

/** Calcul HT : écart = régule − avance ; TVA 19 % sur l'écart ; part TTC = écart + TVA. */
export function calc(a: CaarAnalysis, idx: CaarRegulIndex | null, saisies: Readonly<Record<string, CaarSaisie>>): { rows: CaarCalcRow[]; tot: CaarCalcTot } {
  const rows = a.months.map((v): CaarCalcRow => {
    const av = avanceOf(a.s, v, idx, saisies);
    const regule = a.regule[v] ?? 0;
    const total = a.total[v] ?? 0;
    const ecart = r2(regule - av.avance);
    const tva = r2(ecart * CAAR_TAUX.tva);
    return { ym: v, key: av.key, total, avance: av.avance, regule, complement: r2(total - av.avance), prod: r2(regule - total), ecart, tva, pa: r2(ecart + tva), fact: av.fact, ttc: av.ttc, sansFacture: av.sansFacture, edited: av.edited, hasFile: a.lots.some((f) => f.ym === v) };
  });
  const sum = (k: keyof CaarCalcTot): number => r2(rows.reduce((acc, r) => acc + r[k], 0));
  const ecart = sum("ecart");
  const tva = r2(ecart * CAAR_TAUX.tva);
  return { rows, tot: { total: sum("total"), avance: sum("avance"), regule: sum("regule"), complement: sum("complement"), prod: sum("prod"), ecart, tva, pa: r2(ecart + tva) } };
}

/** Agences en anomalie d'un mois, pour le suivi. */
export function topAgences(a: CaarAnalysis, v: number): string {
  return (a.agTab[v] ?? [])
    .filter((o) => o.statut === "ANOMALIE")
    .sort((x, y) => Math.abs(y.d) - Math.abs(x.d))
    .slice(0, 4)
    .map((o) => `${o.a} (${o.d > 0 ? "+" : ""}${Math.round(o.d).toLocaleString("fr-FR")})`)
    .join(" · ");
}

/* ---------- période, nom de fichier, mail ---------- */

/** « mai, juin et juillet 2026 » ou « 1er trimestre 2027 (janvier, février et mars) ». */
export function periodeText(months: readonly number[]): string {
  const ms = [...months].sort((a, b) => a - b);
  const noms = ms.map((v) => (REGUL_MOIS[(v % 100) - 1] ?? "").toLowerCase());
  const liste = noms.length > 1 ? `${noms.slice(0, -1).join(", ")} et ${noms[noms.length - 1] ?? ""}` : (noms[0] ?? "");
  const first = ms[0] ?? 0;
  const last = ms[ms.length - 1] ?? 0;
  const y = Math.floor(first / 100);
  if (ms.length === 3 && y >= 2027 && Math.floor(last / 100) === y && (first % 100) % 3 === 1 && last - first === 2) {
    const t = Math.ceil((first % 100) / 3);
    return `${t === 1 ? "1er" : `${t}e`} trimestre ${y} (${liste})`;
  }
  const ys = new Set(ms.map((v) => Math.floor(v / 100)));
  return ys.size === 1 ? `${liste} ${y}` : ms.map((v) => ymLabel(v).toLowerCase()).join(", ");
}

/** Nom du classeur exporté. */
export function exportName(a: CaarAnalysis): string {
  const first = a.months[0] ?? 0;
  const y = Math.floor(first / 100);
  if (y >= 2027 && a.months.length === 3) return `Regule_10_CAAR_${a.s}_${trimestreOf(first)}_${y}.xlsx`;
  const noms = a.months.map((v) => (REGUL_MOIS[(v % 100) - 1] ?? "").slice(0, 4).normalize("NFD").replace(/[̀-ͯ]/g, ""));
  return `Regule_10_CAAR_${a.s}_${noms.join("-")}_${Math.floor((a.months[a.months.length - 1] ?? 0) / 100)}.xlsx`;
}

const da = (n: number): string => `${r2(n).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DA`;
const sgnDa = (n: number): string => `${n > 0 ? "+" : ""}${da(n)}`;

/** Mail qui accompagne le classeur envoyé à la succursale. */
export function buildCaarMail(a: CaarAnalysis, c: { rows: CaarCalcRow[]; tot: CaarCalcTot }, signataire: string): { subject: string; body: string } {
  const S = CAAR_LABELS[a.s];
  const per = periodeText(a.months);
  const subject = `Régularisation du complément 10 % – Succursale CAAR ${S} – ${per.charAt(0).toUpperCase()}${per.slice(1)}`;
  const cnt = (s: Situation): number => a.ecarts.filter((e) => e.sit === s).length;
  const sm = (s: Situation): number => r2(a.ecarts.filter((e) => e.sit === s).reduce((x, e) => x + e.d, 0));
  const L: string[] = ["Bonjour,", ""];
  L.push(`Vous trouverez ci-joint le fichier de régularisation du complément 10 % pour la succursale CAAR ${S}, pour ${per}. Il a été établi à partir des fichiers de production que vous nous avez transmis, rapprochés police par police de la production qui a servi à la facturation de l'avance de 90 %.`, "");
  L.push("Récapitulatif (montants HT, part ALLO 47 %) :");
  for (const r of c.rows) L.push(`- ${ymLabel(r.ym)} : production régularisée ${da(r.regule)}, avance 90 % perçue ${da(r.avance)}${r.fact ? ` (facture ${r.fact})` : ""}, écart ${da(r.ecart)}.`);
  L.push("", `Montant de la régularisation : ${da(c.tot.ecart)} HT, TVA 19 % ${da(c.tot.tva)}, soit ${da(c.tot.pa)} TTC.`, "");
  const pts: string[] = [];
  if (cnt("Nouvelle police")) pts.push(`${cnt("Nouvelle police")} police(s) présente(s) dans vos fichiers mais absente(s) de l'avance (${sgnDa(sm("Nouvelle police"))}).`);
  if (cnt("Police réintégrée")) pts.push(`${cnt("Police réintégrée")} police(s) à date d'effet antérieure au mois, exclue(s) de l'avance et réintégrée(s) (${sgnDa(sm("Police réintégrée"))}).`);
  if (cnt("Montant modifié")) pts.push(`${cnt("Montant modifié")} police(s) dont le montant diffère de l'avance (${sgnDa(sm("Montant modifié"))}).`);
  if (cnt("Police retirée")) pts.push(`${cnt("Police retirée")} police(s) facturée(s) dans l'avance mais absente(s) de vos fichiers (${da(sm("Police retirée"))}).`);
  const abs: string[] = [];
  for (const v of a.months) for (const o of a.agTab[v] ?? []) if (o.nF === 0 && o.nB > 0) abs.push(`agence ${o.a} (${(REGUL_MOIS[(v % 100) - 1] ?? "").toLowerCase()})`);
  if (abs.length) pts.push(`Agence(s) absente(s) de vos fichiers alors qu'elles figuraient dans l'avance : ${abs.join(", ")}. Merci de nous confirmer s'il s'agit d'un oubli.`);
  for (const e of a.ecarts.filter((x) => x.d >= 100000).sort((x, y) => y.d - x.d).slice(0, 3)) pts.push(`Police ${e.pb} (${e.as.trim()}, agence ${e.ag}) : ${sgnDa(e.d)} HT. Merci de nous confirmer que la quittance est bien encaissée.`);
  const tf = a.tunisie.filter((t) => t.ou === "fichier");
  const ta = a.tunisie.filter((t) => t.ou === "avance");
  if (tf.length) pts.push(`${tf.length} police(s) « Formule Assistance TUNISIE » portent un montant dans vos fichiers (${da(tf.reduce((x, t) => x + t.montant, 0))} de prime). Cette garantie ne relève pas de notre convention et doit être à 0 : nous l'avons ramenée à 0 DA. Merci de corriger ces lignes de votre côté.`);
  if (ta.length) pts.push(`${ta.length} police(s) « Formule Assistance TUNISIE » avaient été facturées avec un montant dans l'avance (${da(ta.reduce((x, t) => x + t.montant, 0))} de part ALLO) : elles sont retirées dans cette régularisation.`);
  if (a.nonEnc.length) pts.push(`${a.nonEnc.length} quittance(s) non encaissée(s) laissée(s) de côté.`);
  const sins = a.annul.filter((x) => x.sinistre);
  if (sins.length) pts.push(`${sins.length} police(s) annulée(s) ayant fait l'objet d'une assistance : détail dans l'onglet « ALERTE Annulée+Sinistre ».`);
  if (pts.length) {
    L.push("Points relevés lors du contrôle :");
    for (const p of pts) L.push(`- ${p}`);
    L.push("");
  }
  L.push("Le détail police par police figure dans l'onglet « Écart » du fichier, et le contrôle agence par agence dans l'onglet « Détail par agence ».");
  L.push("Merci de nous faire part de vos éventuelles remarques ; à défaut, nous établirons la facture de régularisation sur cette base.", "");
  L.push("Cordialement,");
  if (signataire) L.push(signataire);
  L.push("EURL ALLO ASSISTANCE", "Tél. : +213 982 30 40 40 / +213 23 13 59 31");
  return { subject, body: L.join("\n") };
}
