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
  /** Fichier d'origine de chaque ligne (index dans `fichiers`), même longueur que `rows` ; absent des enregistrements anciens. */
  origine?: number[];
}

/** Statut d'une police de l'avance absente de la régularisation. */
export type PoliceStatut = "REPORTEE" | "REPORTEE_PROBABLE" | "ANNULEE" | "INTROUVABLE";

/** Libellés des statuts. */
export const STATUT_LABELS: Readonly<Record<PoliceStatut, string>> = { REPORTEE: "Reportée", REPORTEE_PROBABLE: "Reportée probable", ANNULEE: "Annulée", INTROUVABLE: "Introuvable" };

/** Mention portée par une ligne introuvable dont la prime nette est positive malgré une ligne négative. */
export const REMARQUE_GARANTIE = "changement de garantie possible";

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
  /** Précision éventuelle sur le statut (ex. changement de garantie possible). */
  remarque: string;
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
const byRank = (a: string, b: string): number => extRank(b) - extRank(a) || (a < b ? -1 : 1);
const cut = (value: string, max: number): string => (value.length > max ? value.slice(0, max) : value);
const rowKey = (row: FichierRow): string => `${row[0]}|${row[1]}|${norm(row[2])}|${row[3]}|${row[4].toFixed(2)}|${row[5]}`;

/** Limite de lignes par envoi (le corps d'une server action est plafonné). */
export const LOT_LIGNES = 20000;

/**
 * Fusionne les lignes de plusieurs fichiers d'un même mois : un même contenu présent dans deux fichiers (xlsx et csv) n'est compté qu'une fois,
 * les lignes identiques à l'intérieur d'un même fichier sont conservées. Chaque ligne garde son fichier d'origine.
 */
function fusionParFichier(perFile: Map<string, FichierRow[]>): { names: string[]; rows: FichierRow[]; origine: number[] } {
  const names = [...perFile.keys()].sort(byRank);
  const merged = new Map<string, { row: FichierRow; n: number; o: number }>();
  names.forEach((name, o) => {
    const counts = new Map<string, { row: FichierRow; n: number }>();
    for (const row of perFile.get(name) ?? []) {
      const key = rowKey(row);
      const cur = counts.get(key);
      if (cur) cur.n++;
      else counts.set(key, { row, n: 1 });
    }
    for (const [key, v] of counts) {
      const cur = merged.get(key);
      if (!cur) merged.set(key, { row: v.row, n: v.n, o });
      else if (v.n > cur.n) {
        cur.n = v.n;
        cur.o = o;
      }
    }
  });
  const rows: FichierRow[] = [];
  const origine: number[] = [];
  for (const { row, n, o } of merged.values())
    for (let i = 0; i < n; i++) {
      rows.push(row);
      origine.push(o);
    }
  return { names, rows, origine };
}

/**
 * Construit les fichiers à conserver (un par mois) à partir des lignes analysées.
 * Les lignes sont dédoublonnées entre fichiers d'un même mois (un même contenu déposé en xlsx et en csv n'est compté qu'une fois) ;
 * les lignes identiques à l'intérieur d'un même fichier sont conservées. Les cellules parasites (police, immatriculation, libellés trop longs) sont tronquées.
 */
export function buildFichiers(succ: string, annee: number, groups: { valid: AnalysedLine[]; annul: AnalysedLine[]; garan: AnalysedLine[] }, maj: string): RegulFichier[] {
  const byMonth = new Map<number, Array<[AnalysedLine, FichierFlag]>>();
  const add = (list: AnalysedLine[], flag: FichierFlag): void => {
    for (const x of list) {
      let bucket = byMonth.get(x.m);
      if (!bucket) {
        bucket = [];
        byMonth.set(x.m, bucket);
      }
      bucket.push([x, flag]);
    }
  };
  add(groups.valid, 0);
  add(groups.annul, 1);
  add(groups.garan, 2);
  return [...byMonth.keys()]
    .sort((a, b) => a - b)
    .map((mois) => {
      const produits: string[] = [];
      const agences: Record<string, string> = {};
      const perFile = new Map<string, FichierRow[]>();
      for (const [x, flag] of byMonth.get(mois) ?? []) {
        if (x.code && x.agence) agences[String(x.code)] = cut(x.agence, 200);
        const produit = cut(x.produit, 80);
        let p = produits.indexOf(produit);
        if (p < 0) p = produits.push(produit) - 1;
        const name = cut(x.fichier, 200);
        let list = perFile.get(name);
        if (!list) {
          list = [];
          perFile.set(name, list);
        }
        list.push([x.code, cut(x.bp, 80), cut(x.immat, 80), p, x.pa, flag]);
      }
      const { names, rows, origine } = fusionParFichier(perFile);
      return { succ, mois, annee, maj, fichiers: names, agences, produits, rows, origine };
    });
}

/** Découpe un fichier en lots d'au plus `max` lignes (mêmes clés, à fusionner côté serveur) ; un fichier court reste d'un seul lot. */
export function decouperFichier(f: RegulFichier, max: number = LOT_LIGNES): RegulFichier[] {
  if (f.rows.length <= max) return [f];
  const lots: RegulFichier[] = [];
  for (let i = 0; i < f.rows.length; i += max) lots.push({ ...f, rows: f.rows.slice(i, i + max), origine: f.origine?.slice(i, i + max) });
  return lots;
}

/** Résultat de la fusion d'un envoi avec l'enregistrement existant. */
export interface FusionFichier {
  fichier: RegulFichier;
  /** Fichiers de l'enregistrement existant conservés (absents du nouvel envoi). */
  conserves: string[];
  /** Fichiers de l'ancien enregistrement dont les lignes n'ont pas pu être conservées (ancien format sans origine). */
  perdus: string[];
}

/**
 * Fusionne un envoi avec l'enregistrement existant du même mois, par nom de fichier :
 * les fichiers absents de l'envoi sont conservés, ceux rechargés sont remplacés. Avec `suite`, l'envoi complète un lot précédent du même chargement (rien n'est remplacé).
 */
export function fusionnerFichier(existing: RegulFichier | null, incoming: RegulFichier, suite: boolean): FusionFichier {
  const produits = existing ? [...existing.produits] : [];
  const remap = incoming.produits.map((name) => {
    const at = produits.indexOf(name);
    return at >= 0 ? at : produits.push(name) - 1;
  });
  const perFile = new Map<string, FichierRow[]>();
  const push = (name: string, row: FichierRow): void => {
    let list = perFile.get(name);
    if (!list) {
      list = [];
      perFile.set(name, list);
    }
    list.push(row);
  };
  const replaced = new Set(suite ? [] : incoming.fichiers);
  const conserves: string[] = [];
  const perdus: string[] = [];
  if (existing) {
    const attributed = Array.isArray(existing.origine) && existing.origine.length === existing.rows.length;
    for (const name of existing.fichiers) {
      if (replaced.has(name)) continue;
      if (attributed) {
        if (!perFile.has(name)) perFile.set(name, []);
        if (!suite) conserves.push(name);
      } else perdus.push(name);
    }
    if (attributed) {
      existing.rows.forEach((row, i) => {
        const name = existing.fichiers[existing.origine?.[i] ?? -1];
        if (name !== undefined && !replaced.has(name)) push(name, row);
      });
    }
  }
  for (const name of incoming.fichiers) if (!perFile.has(name)) perFile.set(name, []);
  incoming.rows.forEach((row, i) => {
    const name = incoming.fichiers[incoming.origine?.[i] ?? 0] ?? incoming.fichiers[0] ?? "fichier";
    push(name, [row[0], row[1], row[2], remap[row[3]] ?? row[3], row[4], row[5]]);
  });
  const { names, rows, origine } = fusionParFichier(perFile);
  const fichier: RegulFichier = { ...incoming, fichiers: names, agences: { ...(existing?.agences ?? {}), ...incoming.agences }, produits, rows, origine };
  return { fichier, conserves: conserves.sort(byRank), perdus };
}

/** Lit un réglage « regul:fichier:* » : renvoie null si la forme est inconnue (données anciennes à recharger), sans jamais lever d'erreur. */
export function lireFichier(value: unknown): RegulFichier | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const strings = (x: unknown): x is string[] => Array.isArray(x) && x.every((e) => typeof e === "string");
  if (typeof v.succ !== "string" || typeof v.mois !== "number" || typeof v.annee !== "number") return null;
  if (!strings(v.fichiers) || !strings(v.produits) || typeof v.agences !== "object" || v.agences === null || !Array.isArray(v.rows)) return null;
  for (const r of v.rows as unknown[]) {
    if (!Array.isArray(r) || r.length !== 6 || typeof r[0] !== "number" || typeof r[1] !== "string" || typeof r[2] !== "string" || typeof r[3] !== "number" || typeof r[4] !== "number" || (r[5] !== 0 && r[5] !== 1 && r[5] !== 2)) return null;
  }
  const origine = Array.isArray(v.origine) && v.origine.length === v.rows.length && v.origine.every((o) => typeof o === "number") ? (v.origine as number[]) : undefined;
  return { succ: v.succ, mois: v.mois, annee: v.annee, maj: typeof v.maj === "string" ? v.maj : "", fichiers: v.fichiers, agences: v.agences as Record<string, string>, produits: v.produits, rows: v.rows as FichierRow[], origine };
}

/** Critères de sélection du croisement. */
export interface PolicesFilter {
  /** Mois examinés (vide : tous les mois ayant une régularisation conservée). */
  mois?: number[];
  agence?: number | null;
}

interface Cnt {
  n: number;
  pa: number;
}
interface Presence {
  full: Map<string, Cnt>;
  illegible: Map<string, Cnt>;
  byPolice: Map<string, Cnt>;
}

const keyOf = (police: string, immat: string): string => `${basePolice(police)}|${norm(immat)}`;
const legible = (immat: string): boolean => norm(immat).length >= 4;
const bump = (map: Map<string, Cnt>, key: string, pa: number): void => {
  const cur = map.get(key);
  if (cur) {
    cur.n++;
    cur.pa += pa;
  } else map.set(key, { n: 1, pa });
};
const newPresence = (): Presence => ({ full: new Map(), illegible: new Map(), byPolice: new Map() });
const addTo = (p: Presence, police: string, immat: string, pa: number): void => {
  const bp = basePolice(police);
  bump(p.byPolice, bp, pa);
  if (legible(immat)) bump(p.full, keyOf(police, immat), pa);
  else bump(p.illegible, bp, pa);
};
/** Nombre de lignes et part assisteur d'un (police, immatriculation) dans un mois ; police seule si l'immatriculation est illisible. */
const countIn = (p: Presence | undefined, police: string, immat: string): Cnt => {
  if (!p) return { n: 0, pa: 0 };
  const bp = basePolice(police);
  if (!legible(immat)) return p.byPolice.get(bp) ?? { n: 0, pa: 0 };
  const full = p.full.get(keyOf(police, immat));
  const ill = p.illegible.get(bp);
  return { n: (full?.n ?? 0) + (ill?.n ?? 0), pa: (full?.pa ?? 0) + (ill?.pa ?? 0) };
};
/**
 * Présence d'une police de l'avance dans la régularisation du même mois.
 * Immatriculation lisible de part et d'autre : correspondance exacte. Immatriculation illisible d'un côté : la police n'est déclarée présente
 * que si la régularisation contient au moins autant de lignes pour cette police que l'avance de véhicules (limite : on ne sait pas dire lequel manque).
 */
const presentIn = (reg: Presence, baseM: Presence | undefined, police: string, immat: string): boolean => {
  const bp = basePolice(police);
  const regN = reg.byPolice.get(bp)?.n ?? 0;
  const baseN = baseM?.byPolice.get(bp)?.n ?? 1;
  if (legible(immat)) return reg.full.has(keyOf(police, immat)) || ((reg.illegible.get(bp)?.n ?? 0) > 0 && regN >= baseN);
  return regN > 0 && regN >= baseN;
};

interface BaseGroup {
  row: BaseRow;
  net: number;
  pa: number;
  neg: BaseRow | null;
  negProd: Set<number>;
  posProd: Set<number>;
}
/** Annulée : somme nette ≤ 0, ou ligne négative sans ligne positive de produit différent (sinon : changement de garantie possible). */
const isCancelled = (g: BaseGroup): boolean => g.neg !== null && (g.net <= 0 || [...g.posProd].every((p) => g.negProd.has(p)));
const sameCents = (a: number, b: number): boolean => Math.abs(a - b) < 0.005;

/**
 * Croise la base « avance 90 % » et les fichiers de régularisation conservés d'une succursale.
 * Une police de l'avance (police sans avenant + immatriculation, ou police seule si l'immatriculation est illisible) absente de la régularisation du même mois est :
 * ANNULÉE (prime nette du groupe police + immatriculation + mois ≤ 0, ou annulation en régularisation), REPORTÉE (régularisation d'un mois POSTÉRIEUR qui compte plus de lignes que l'avance de ces mois),
 * REPORTÉE (consolidé d'un mois suivant avec la même part assisteur) ou REPORTÉE PROBABLE (part assisteur différente), sinon INTROUVABLE.
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
    let list = regulBy.get(f.mois);
    if (!list) {
      list = [];
      regulBy.set(f.mois, list);
    }
    for (const r of f.rows) {
      list.push(r);
      produitOf.set(r, f.produits[r[3]] ?? "");
    }
  }
  const regulPresence = new Map<number, Presence>();
  const regulAnnulKeys = new Set<string>();
  for (const [m, rows] of regulBy) {
    const p = newPresence();
    for (const r of rows) {
      if (r[5] !== 1) addTo(p, r[1], r[2], r[4]);
      else regulAnnulKeys.add(legible(r[2]) ? keyOf(r[1], r[2]) : `${basePolice(r[1])}|`);
    }
    regulPresence.set(m, p);
  }
  const baseByMonth = new Map<number, BaseRow[]>();
  const basePresence = new Map<number, Presence>();
  for (const r of base) {
    let list = baseByMonth.get(r[0]);
    if (!list) {
      list = [];
      baseByMonth.set(r[0], list);
    }
    list.push(r);
    if (r[5] >= 0) {
      let p = basePresence.get(r[0]);
      if (!p) {
        p = newPresence();
        basePresence.set(r[0], p);
      }
      addTo(p, r[2], r[3], r[6]);
    }
  }
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
    remarque: "",
    sinistre: isSin(police, immat),
  });

  for (const m of wanted) {
    const regulM = regulPresence.get(m);
    const baseRows = baseByMonth.get(m) ?? [];
    // Une ligne par agence + police + immatriculation + mois (primes nettes), avec les produits positifs et négatifs.
    const groups = new Map<string, BaseGroup>();
    for (const r of baseRows) {
      if (!agMatch(r[1])) continue;
      const k = `${r[1]}|${legible(r[3]) ? keyOf(r[2], r[3]) : `${basePolice(r[2])}|`}`;
      let g = groups.get(k);
      if (!g) {
        g = { row: r, net: 0, pa: 0, neg: null, negProd: new Set(), posProd: new Set() };
        groups.set(k, g);
      }
      g.net += r[5];
      g.pa += r[6];
      if (r[5] < 0) {
        g.neg ??= r;
        g.negProd.add(r[4]);
      } else g.posProd.add(r[4]);
    }
    if (!regulM) {
      if (baseRows.length || filter.mois?.length) moisSansRegul.push(m);
    } else {
      const baseM = basePresence.get(m);
      const laterRegul = [...regulPresence.keys()].filter((mm) => mm > m).sort((a, b) => a - b);
      const laterBase = [...basePresence.keys()].filter((mm) => mm > m).sort((a, b) => a - b);
      for (const g of groups.values()) {
        const r = g.row;
        if (presentIn(regulM, baseM, r[2], r[3])) continue;
        const annulKey = legible(r[3]) ? keyOf(r[2], r[3]) : `${basePolice(r[2])}|`;
        const annule = isCancelled(g) || regulAnnulKeys.has(annulKey);
        const row = common(r[1], m, r[2], r[3], REGUL_PROD[r[4]] ?? "", g.pa, "base", annule);
        // Régularisations des mois postérieurs : « reportée » seulement si elles comptent plus de lignes que l'avance de ces mêmes mois (flotte mensuelle : sinon INTROUVABLE).
        const regulMonths = laterRegul.filter((mm) => countIn(regulPresence.get(mm), r[2], r[3]).n > 0);
        const regulLines = regulMonths.reduce((n, mm) => n + countIn(regulPresence.get(mm), r[2], r[3]).n, 0);
        const baseLines = laterBase.reduce((n, mm) => n + countIn(basePresence.get(mm), r[2], r[3]).n, 0);
        const baseMonths = laterBase.filter((mm) => countIn(basePresence.get(mm), r[2], r[3]).n > 0);
        if (regulLines > baseLines) {
          row.statut = "REPORTEE";
          row.reapparition = regulMonths;
          row.reapparitionSource = "regul";
        } else if (annule) row.statut = "ANNULEE";
        else if (!regulMonths.length && baseMonths.length) {
          row.statut = baseMonths.some((mm) => sameCents(countIn(basePresence.get(mm), r[2], r[3]).pa, g.pa)) ? "REPORTEE" : "REPORTEE_PROBABLE";
          row.reapparition = baseMonths;
          row.reapparitionSource = "base";
        } else {
          row.statut = "INTROUVABLE";
          if (g.neg !== null) row.remarque = REMARQUE_GARANTIE;
        }
        pushUnique(absentes, seenAbs, row);
      }
    }
    // Annulées : lignes d'annulation de la régularisation et groupes annulés du consolidé.
    for (const r of regulBy.get(m) ?? []) {
      if (!agMatch(r[0])) continue;
      const garantie = produitOf.get(r) ?? "";
      const row = common(r[0], m, r[1], r[2], garantie, r[4], "regul", r[5] === 1);
      if (r[5] === 1) pushUnique(annulees, seenAnn, row);
      if (r[5] !== 2) pushUnique(sinistrees, seenSin, row);
    }
    for (const g of groups.values()) {
      const r = g.neg;
      if (r && isCancelled(g)) pushUnique(annulees, seenAnn, common(r[1], m, r[2], r[3], REGUL_PROD[r[4]] ?? "", r[6], "base", true));
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
  reporteesProbables: number;
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
    const cur = map.get(x.code) ?? { succ: r.succ, code: x.code, agence: x.agence, absentes: 0, reportees: 0, reporteesProbables: 0, annulees: 0, introuvables: 0, annuleesTotal: 0, sinistrees: 0, annuleesSinistre: 0 };
    if (!cur.agence && x.agence) cur.agence = x.agence;
    map.set(x.code, cur);
    return cur;
  };
  for (const x of r.absentes) {
    const c = at(x);
    c.absentes++;
    if (x.statut === "REPORTEE") c.reportees++;
    else if (x.statut === "REPORTEE_PROBABLE") c.reporteesProbables++;
    else if (x.statut === "ANNULEE") c.annulees++;
    else c.introuvables++;
  }
  for (const x of r.annulees) at(x).annuleesTotal++;
  for (const x of r.sinistrees) at(x).sinistrees++;
  for (const x of r.annuleesSinistre) at(x).annuleesSinistre++;
  return [...map.values()].sort((a, b) => a.code - b.code);
}

/** Retire les lignes dont le statut ne correspond pas (filtre « statut » de l'écran : il ne s'applique qu'aux polices non retrouvées, pas aux listes annulées / sinistrées). */
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
  /** Succursales dont des données conservées sont d'une ancienne forme (ignorées : à recharger). */
  anciennes?: string[];
}

