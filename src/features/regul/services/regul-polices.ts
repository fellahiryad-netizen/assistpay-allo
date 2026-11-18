import { basePolice, norm, REGUL_PROD, type AnalysedLine, type BaseRow } from "@/features/regul/services/regul-engine";

/* Conservation des polices des fichiers de régularisation 10 % et croisement avec la base « avance 90 % » : fonctions pures, sans calcul de montant. */

/** Nature d'une ligne conservée : valide, annulation (prime négative) ou changement de garantie. */
export type FichierFlag = 0 | 1 | 2;

/** Ligne conservée : [code agence, police sans avenant, immatriculation, index du produit, part assisteur, indicateur]. */
export type FichierRow = [number, string, string, number, number, FichierFlag];

/** Polices d'un fichier de régularisation conservées pour un mois (réglage « regul:fichier:SUCC:AAAA-MM »). */
export interface RegulFichier {
  succ: string;
  mois: number;
  annee: number;
  maj: string;
  fichiers: string[];
  agences: Record<string, string>;
  produits: string[];
  rows: FichierRow[];
}

/** Statut d'une police de l'avance absente de la régularisation. */
export type PoliceStatut = "REPORTEE" | "ANNULEE" | "INTROUVABLE";

/** Libellés des statuts. */
export const STATUT_LABELS: Readonly<Record<PoliceStatut, string>> = { REPORTEE: "Reportée", ANNULEE: "Annulée", INTROUVABLE: "Introuvable" };

/** Police (une ligne par police + immatriculation + mois) issue du croisement. */
export interface PoliceRow {
  succ: string;
  code: number;
  agence: string;
  mois: number;
  police: string;
  immat: string;
  garantie: string;
  pa: number;
  /** Origine de la ligne : consolidé avance 90 % ou fichier de régularisation. */
  source: "base" | "regul";
  /** Statut si la police de l'avance est absente de la régularisation du mois ; vide sinon. */
  statut: PoliceStatut | "";
  /** Mois où la police réapparaît (statut Reportée). */
  reapparition: number[];
  reapparitionSource: "regul" | "base" | "";
  annulee: boolean;
  /** Vrai / faux selon la base sinistres, null si elle n'est pas chargée. */
  sinistre: boolean | null;
}

/** Résultat du croisement pour une succursale. */
export interface PolicesSucc {
  succ: string;
  /** Mois pour lesquels une régularisation est conservée. */
  moisRegul: number[];
  /** Mois examinés sans régularisation conservée (contrôle impossible). */
  moisSansRegul: number[];
  /** Polices de l'avance absentes de la régularisation (toutes causes). */
  absentes: PoliceRow[];
  annulees: PoliceRow[];
  sinistrees: PoliceRow[];
  annuleesSinistre: PoliceRow[];
}

const pad = (n: number): string => String(n).padStart(2, "0");

/** Clé du réglage d'un fichier de régularisation conservé. */
export const fichierKey = (succId: string, annee: number, mois: number): string => `regul:fichier:${succId}:${annee}-${pad(mois)}`;

/** Préfixe des réglages des fichiers conservés d'une succursale. */
export const fichierPrefix = (succId: string): string => `regul:fichier:${succId}:`;

const extRank = (name: string): number => (/\.csv$|\.txt$/i.test(name) ? 0 : 1);

/**
 * Construit les fichiers à conserver (un par mois) à partir des lignes analysées.
 * Les lignes sont dédoublonnées entre fichiers d'un même mois (un même contenu déposé en xlsx et en csv n'est compté qu'une fois) ;
 * les lignes identiques à l'intérieur d'un même fichier sont conservées.
 */
export function buildFichiers(succ: string, annee: number, groups: { valid: AnalysedLine[]; annul: AnalysedLine[]; garan: AnalysedLine[] }, maj: string): RegulFichier[] {
  const flagged: Array<[AnalysedLine, FichierFlag]> = [
    ...groups.valid.map((x): [AnalysedLine, FichierFlag] => [x, 0]),
    ...groups.annul.map((x): [AnalysedLine, FichierFlag] => [x, 1]),
    ...groups.garan.map((x): [AnalysedLine, FichierFlag] => [x, 2]),
  ];
  const months = [...new Set(flagged.map(([x]) => x.m))].sort((a, b) => a - b);
  return months.map((mois) => {
    const produits: string[] = [];
    const agences: Record<string, string> = {};
    const perFile = new Map<string, Map<string, { row: FichierRow; n: number }>>();
    for (const [x, flag] of flagged) {
      if (x.m !== mois) continue;
      if (x.code && x.agence) agences[String(x.code)] = x.agence;
      let p = produits.indexOf(x.produit);
      if (p < 0) p = produits.push(x.produit) - 1;
      const row: FichierRow = [x.code, x.bp, x.immat, p, x.pa, flag];
      const key = `${row[0]}|${row[1]}|${norm(row[2])}|${row[3]}|${row[4].toFixed(2)}|${row[5]}`;
      const file = perFile.get(x.fichier) ?? new Map<string, { row: FichierRow; n: number }>();
      const cur = file.get(key);
      if (cur) cur.n++;
      else file.set(key, { row, n: 1 });
      perFile.set(x.fichier, file);
    }
    const merged = new Map<string, { row: FichierRow; n: number }>();
    for (const file of perFile.values()) {
      for (const [key, v] of file) {
        const cur = merged.get(key);
        if (!cur) merged.set(key, { row: v.row, n: v.n });
        else cur.n = Math.max(cur.n, v.n);
      }
    }
    const rows: FichierRow[] = [];
    for (const { row, n } of merged.values()) for (let i = 0; i < n; i++) rows.push(row);
    const names = [...perFile.keys()].sort((a, b) => extRank(b) - extRank(a) || (a < b ? -1 : 1));
    return { succ, mois, annee, maj, fichiers: names, agences, produits, rows };
  });
}

/** Critères de sélection du croisement. */
export interface PolicesFilter {
  /** Mois examinés (vide : tous les mois ayant une régularisation conservée). */
  mois?: number[];
  agence?: number | null;
}

interface Presence {
  full: Set<string>;
  byPolice: Set<string>;
  illegible: Set<string>;
}

const keyOf = (police: string, immat: string): string => `${basePolice(police)}|${norm(immat)}`;
const legible = (immat: string): boolean => norm(immat).length >= 4;

/**
 * Croise la base « avance 90 % » et les fichiers de régularisation conservés d'une succursale.
 * Une police de l'avance (police sans avenant + immatriculation, ou police seule si l'immatriculation est illisible) absente de la régularisation du même mois est :
 * ANNULÉE (prime négative au consolidé ou annulation en régularisation, sans ligne positive ailleurs), REPORTÉE (présente dans la régularisation d'un autre mois, sinon au consolidé d'un mois suivant) ou INTROUVABLE.
 * Les sinistres sont lus avec la même clé « police | immatriculation » que le moteur de régularisation.
 */
export function croiserPolices(succ: string, base: BaseRow[], fichiers: RegulFichier[], sin: Set<string> | null, agencesIdx: Record<string, string>, filter: PolicesFilter = {}): PolicesSucc {
  const moisRegul = [...new Set(fichiers.map((f) => f.mois))].sort((a, b) => a - b);
  const wanted = filter.mois?.length ? [...filter.mois].sort((a, b) => a - b) : moisRegul;
  const names: Record<string, string> = { ...agencesIdx };
  for (const f of fichiers) Object.assign(names, f.agences);
  const nom = (code: number): string => names[String(code)] ?? "";
  const regulBy = new Map<number, FichierRow[]>();
  const produitOf = new Map<FichierRow, string>();
  for (const f of fichiers) {
    regulBy.set(f.mois, [...(regulBy.get(f.mois) ?? []), ...f.rows]);
    for (const r of f.rows) produitOf.set(r, f.produits[r[3]] ?? "");
  }
  const presence = (rows: FichierRow[]): Presence => {
    const p: Presence = { full: new Set(), byPolice: new Set(), illegible: new Set() };
    for (const r of rows) {
      p.byPolice.add(r[1]);
      if (legible(r[2])) p.full.add(keyOf(r[1], r[2]));
      else p.illegible.add(r[1]);
    }
    return p;
  };
  const presentIn = (p: Presence, police: string, immat: string): boolean => (legible(immat) ? p.full.has(keyOf(police, immat)) || p.illegible.has(basePolice(police)) : p.byPolice.has(basePolice(police)));
  const regulPresence = new Map<number, Presence>();
  for (const [m, rows] of regulBy) regulPresence.set(m, presence(rows.filter((r) => r[5] !== 1)));
  const regulAnnulKeys = new Set<string>();
  for (const rows of regulBy.values()) for (const r of rows) if (r[5] === 1) regulAnnulKeys.add(legible(r[2]) ? keyOf(r[1], r[2]) : `${r[1]}|`);
  const baseByMonth = new Map<number, BaseRow[]>();
  for (const r of base) baseByMonth.set(r[0], [...(baseByMonth.get(r[0]) ?? []), r]);
  const basePresence = new Map<number, Presence>();
  for (const [m, rows] of baseByMonth) basePresence.set(m, presence(rows.filter((r) => r[5] >= 0).map((r): FichierRow => [r[1], basePolice(r[2]), r[3], 0, r[6], 0])));
  const baseNeg = new Set<string>();
  for (const r of base) if (r[5] < 0) baseNeg.add(legible(r[3]) ? keyOf(r[2], r[3]) : `${basePolice(r[2])}|`);
  const isSin = (police: string, immat: string): boolean | null => (sin ? sin.has(keyOf(police, immat)) : null);

  const absentes: PoliceRow[] = [];
  const annulees: PoliceRow[] = [];
  const sinistrees: PoliceRow[] = [];
  const moisSansRegul: number[] = [];
  const agMatch = (code: number): boolean => filter.agence == null || filter.agence === code;
  const seenAbs = new Set<string>();
  const seenAnn = new Set<string>();
  const seenSin = new Set<string>();
  const pushUnique = (list: PoliceRow[], seen: Set<string>, row: PoliceRow): void => {
    const k = `${row.mois}|${row.code}|${row.police}|${norm(row.immat)}`;
    if (seen.has(k)) return;
    seen.add(k);
    list.push(row);
  };
  const common = (code: number, mois: number, police: string, immat: string, garantie: string, pa: number, source: "base" | "regul", annulee: boolean): PoliceRow => ({
    succ,
    code,
    agence: nom(code),
    mois,
    police: basePolice(police),
    immat,
    garantie,
    pa,
    source,
    statut: "",
    reapparition: [],
    reapparitionSource: "",
    annulee,
    sinistre: isSin(police, immat),
  });

  for (const m of wanted) {
    const regulM = regulPresence.get(m);
    const baseRows = baseByMonth.get(m) ?? [];
    if (!regulM) {
      if (baseRows.length || filter.mois?.length) moisSansRegul.push(m);
    } else {
      // Polices de l'avance absentes de la régularisation du même mois (une ligne par police + immatriculation).
      const grouped = new Map<string, BaseRow>();
      for (const r of baseRows) {
        if (!agMatch(r[1])) continue;
        const k = `${r[1]}|${legible(r[3]) ? keyOf(r[2], r[3]) : `${basePolice(r[2])}|`}`;
        const cur = grouped.get(k);
        grouped.set(k, cur ? [cur[0], cur[1], cur[2], cur[3], cur[4], cur[5] + r[5], cur[6] + r[6]] : r);
      }
      for (const r of grouped.values()) {
        if (presentIn(regulM, r[2], r[3])) continue;
        const negative = r[5] < 0 || baseNeg.has(legible(r[3]) ? keyOf(r[2], r[3]) : `${basePolice(r[2])}|`);
        const annulKey = legible(r[3]) ? keyOf(r[2], r[3]) : `${basePolice(r[2])}|`;
        const otherRegul = [...regulPresence.entries()].filter(([mm, p]) => mm !== m && presentIn(p, r[2], r[3])).map(([mm]) => mm);
        const laterBase = [...basePresence.entries()].filter(([mm, p]) => mm > m && presentIn(p, r[2], r[3])).map(([mm]) => mm);
        const row = common(r[1], m, r[2], r[3], REGUL_PROD[r[4]] ?? "", r[6], "base", negative || regulAnnulKeys.has(annulKey));
        if (!otherRegul.length && (negative || regulAnnulKeys.has(annulKey))) row.statut = "ANNULEE";
        else if (otherRegul.length) {
          row.statut = "REPORTEE";
          row.reapparition = otherRegul.sort((a, b) => a - b);
          row.reapparitionSource = "regul";
        } else if (laterBase.length) {
          row.statut = "REPORTEE";
          row.reapparition = laterBase.sort((a, b) => a - b);
          row.reapparitionSource = "base";
        } else row.statut = "INTROUVABLE";
        pushUnique(absentes, seenAbs, row);
      }
    }
    // Annulées : lignes d'annulation de la régularisation et lignes à prime négative du consolidé.
    for (const r of regulBy.get(m) ?? []) {
      if (!agMatch(r[0])) continue;
      const garantie = produitOf.get(r) ?? "";
      const row = common(r[0], m, r[1], r[2], garantie, r[4], "regul", r[5] === 1);
      if (r[5] === 1) pushUnique(annulees, seenAnn, row);
      if (r[5] !== 2) pushUnique(sinistrees, seenSin, row);
    }
    for (const r of baseRows) {
      if (!agMatch(r[1])) continue;
      if (r[5] < 0) pushUnique(annulees, seenAnn, common(r[1], m, r[2], r[3], REGUL_PROD[r[4]] ?? "", r[6], "base", true));
    }
  }
  for (const row of absentes) pushUnique(sinistrees, seenSin, row);
  const sinOnly = sinistrees.filter((x) => x.sinistre === true);
  const order = (a: PoliceRow, b: PoliceRow): number => a.code - b.code || a.mois - b.mois || (a.police < b.police ? -1 : a.police > b.police ? 1 : 0);
  absentes.sort(order);
  annulees.sort(order);
  sinOnly.sort(order);
  return {
    succ,
    moisRegul,
    moisSansRegul,
    absentes,
    annulees,
    sinistrees: sinOnly,
    annuleesSinistre: annulees.filter((x) => x.sinistre === true),
  };
}

/** Compteurs d'une liste de polices par agence (code → nom et totaux). */
export interface AgenceCount {
  succ: string;
  code: number;
  agence: string;
  absentes: number;
  reportees: number;
  annulees: number;
  introuvables: number;
  annuleesTotal: number;
  sinistrees: number;
  annuleesSinistre: number;
}

/** Ventile le résultat d'une succursale par agence. */
export function compterParAgence(r: PolicesSucc): AgenceCount[] {
  const map = new Map<number, AgenceCount>();
  const at = (x: PoliceRow): AgenceCount => {
    const cur = map.get(x.code) ?? { succ: r.succ, code: x.code, agence: x.agence, absentes: 0, reportees: 0, annulees: 0, introuvables: 0, annuleesTotal: 0, sinistrees: 0, annuleesSinistre: 0 };
    if (!cur.agence && x.agence) cur.agence = x.agence;
    map.set(x.code, cur);
    return cur;
  };
  for (const x of r.absentes) {
    const c = at(x);
    c.absentes++;
    if (x.statut === "REPORTEE") c.reportees++;
    else if (x.statut === "ANNULEE") c.annulees++;
    else c.introuvables++;
  }
  for (const x of r.annulees) at(x).annuleesTotal++;
  for (const x of r.sinistrees) at(x).sinistrees++;
  for (const x of r.annuleesSinistre) at(x).annuleesSinistre++;
  return [...map.values()].sort((a, b) => a.code - b.code);
}

/** Retire les lignes dont le statut ne correspond pas (filtre « statut » de l'écran, appliqué aux polices non retrouvées). */
export function filtrerStatut(r: PolicesSucc, statut: PoliceStatut | ""): PolicesSucc {
  if (!statut) return r;
  return { ...r, absentes: r.absentes.filter((x) => x.statut === statut) };
}

/** Filtres de l'écran et de l'export. */
export interface PolicesQuery {
  succ: string;
  agence: number | null;
  statut: PoliceStatut | "";
  mois: number | null;
}

/** Résultat par succursale, avec ventilation par agence. */
export interface PolicesBlock {
  result: PolicesSucc;
  agences: AgenceCount[];
}

/** Données de l'écran « Polices non retrouvées ». */
export interface PolicesView {
  blocks: PolicesBlock[];
  sinLoaded: boolean;
  /** Succursales sans aucune régularisation conservée. */
  sansRegul: string[];
}

