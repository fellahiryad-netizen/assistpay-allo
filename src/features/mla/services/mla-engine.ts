import type { SheetCell, SheetData } from "@/lib/spreadsheet";

/* Facturation MLA (Maghreb Leasing Algérie) : flotte mensuelle, retraits et véhicules sinistrés.
   Fonctions pures, utilisées dans le navigateur (les fichiers dépassent la limite d'envoi du serveur). */

/** Prime annuelle par véhicule (DA HT). */
export const MLA_PRIME_ANNUELLE = 12000;
/** Prime mensuelle encaissée sur un véhicule retiré mais sinistré (DA HT). */
export const MLA_PRIME_RETRAIT_MOIS = 1000;

/** Immatriculation comparable : sans espaces, tirets ni casse (« 025418 118 16 » = « 025418-118-16 »). */
export function normImmat(value: SheetCell | undefined): string {
  return String(value ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
}

/** Mois de la flotte : un onglet « MM AAAA ». */
export interface FleetMonth {
  sheet: string;
  year: number;
  month: number;
  /** Nombre de véhicules de l'onglet. */
  count: number;
  /** Détail par type (VP, VU, motocycle). */
  types: Record<string, number>;
}

/** Véhicule retiré de la flotte. */
export interface Retrait {
  immat: string;
  key: string;
  modele: string;
  type: string;
  /** Date de retrait (AAAA-MM-JJ) ; vide si illisible. */
  date: string;
}

/** Flotte lue dans le classeur MLA. */
export interface FleetFile {
  months: FleetMonth[];
  retraits: Retrait[];
}

/** Dossier d'assistance d'un véhicule. */
export interface Dossier {
  num: string;
  date: string;
  prestation: string;
  statut: string;
}

/** Activité MLA lue : dossiers par immatriculation normalisée. */
export interface ActivityFile {
  byVehicle: Record<string, Dossier[]>;
  dossiers: number;
  vehicules: number;
}

function isoOfDate(date: Date): string {
  const shifted = new Date(date.getTime() + 12 * 3600 * 1000);
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}`;
}

/** Date lue dans une cellule : vraie date, « JJ/MM/AAAA » ou numéro de série Excel. */
export function readDate(value: SheetCell | undefined): string {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "" : isoOfDate(value);
  if (typeof value === "number" && value > 30000 && value < 80000) return isoOfDate(new Date(Date.UTC(1899, 11, 30) + value * 86400000));
  const text = String(value ?? "").trim();
  const fr = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/.exec(text);
  if (fr) return `${fr[3]}-${(fr[2] ?? "").padStart(2, "0")}-${(fr[1] ?? "").padStart(2, "0")}`;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  return iso ? iso[0] : "";
}

/** Lit le classeur de flotte : onglets « MM AAAA » (véhicules du mois) et onglet « Retrait ». */
export function parseFleet(sheets: SheetData[]): FleetFile {
  const months: FleetMonth[] = [];
  for (const sheet of sheets) {
    const match = /^\s*(\d{1,2})\s+(\d{4})\s*$/.exec(sheet.name);
    if (!match) continue;
    const types: Record<string, number> = {};
    let count = 0;
    for (const row of sheet.rows.slice(1)) {
      if (!normImmat(row[1])) continue;
      count += 1;
      const type = String(row[4] ?? "").trim().toLowerCase() || "autre";
      types[type] = (types[type] ?? 0) + 1;
    }
    months.push({ sheet: sheet.name, year: Number(match[2] ?? 0), month: Number(match[1] ?? 0), count, types });
  }
  months.sort((a, b) => a.year * 12 + a.month - (b.year * 12 + b.month));
  const retraitSheet = sheets.find((sheet) => /retrait/i.test(sheet.name));
  const seen = new Set<string>();
  const retraits: Retrait[] = [];
  for (const row of retraitSheet?.rows.slice(1) ?? []) {
    const key = normImmat(row[1]);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    retraits.push({ immat: String(row[1]).trim(), key, modele: String(row[2] ?? "").trim(), type: String(row[4] ?? "").trim(), date: readDate(row[5]) });
  }
  return { months, retraits };
}

function findColumn(header: SheetCell[], pattern: RegExp): number {
  return header.findIndex((cell) => pattern.test(String(cell ?? "")));
}

/** Lit l'export des activités MLA : dossiers actifs et non annulés, regroupés par véhicule. */
export function parseActivities(sheets: SheetData[]): ActivityFile {
  const sheet = sheets.find((entry) => entry.rows.some((row) => row.some((cell) => /^immatriculation$/i.test(String(cell ?? "").trim())))) ?? sheets[0];
  const rows = sheet?.rows ?? [];
  const headerAt = rows.findIndex((row) => row.some((cell) => /^immatriculation$/i.test(String(cell ?? "").trim())));
  if (headerAt < 0) return { byVehicle: {}, dossiers: 0, vehicules: 0 };
  const header = rows[headerAt] ?? [];
  const cImmat = findColumn(header, /^immatriculation$/i);
  const cNum = findColumn(header, /n°\s*dossier/i);
  const cOuv = findColumn(header, /date d.ouverture/i);
  const cCree = findColumn(header, /^créé le/i);
  const cPrest = findColumn(header, /^prestations?$/i);
  const cStatut = findColumn(header, /statut dossier/i);
  const cActif = findColumn(header, /^actif$/i);
  const byVehicle: Record<string, Dossier[]> = {};
  let dossiers = 0;
  for (const row of rows.slice(headerAt + 1)) {
    const key = normImmat(row[cImmat]);
    if (!key) continue;
    const statut = String(row[cStatut] ?? "").trim();
    if (cActif >= 0 && /^non$/i.test(String(row[cActif] ?? "").trim())) continue;
    if (/annul/i.test(statut)) continue;
    (byVehicle[key] ??= []).push({ num: String(row[cNum] ?? "").trim(), date: readDate(row[cOuv]) || readDate(row[cCree]), prestation: String(row[cPrest] ?? "").trim(), statut });
    dossiers += 1;
  }
  return { byVehicle, dossiers, vehicules: Object.keys(byVehicle).length };
}

/** Véhicule retiré du mois, avec ses dossiers. */
export interface RetraitLine extends Retrait {
  dossiers: Dossier[];
  sinistre: boolean;
}

/** Résultat du calcul pour un mois facturé. */
export interface MlaResult {
  year: number;
  month: number;
  vehicules: number;
  annuel: number;
  mensualite: number;
  /** Nombre de mois facturés pour un véhicule retiré sinistré (du mois facturé à décembre). */
  moisRetrait: number;
  prixRetrait: number;
  /** Retraits du mois, sinistrés d'abord. */
  retraits: RetraitLine[];
}

/** Calcule la facture du mois : mensualité de la flotte et retraits du même mois croisés avec l'activité. */
export function computeMla(fleet: FleetFile, monthSheet: string, activity: ActivityFile | null): MlaResult | null {
  const month = fleet.months.find((entry) => entry.sheet === monthSheet);
  if (!month) return null;
  const moisRetrait = 13 - month.month;
  const lines: RetraitLine[] = fleet.retraits
    .filter((retrait) => retrait.date.startsWith(`${month.year}-${String(month.month).padStart(2, "0")}`))
    .map((retrait) => {
      const dossiers = activity?.byVehicle[retrait.key] ?? [];
      return { ...retrait, dossiers, sinistre: dossiers.length > 0 };
    })
    .sort((a, b) => Number(b.sinistre) - Number(a.sinistre) || a.immat.localeCompare(b.immat));
  const annuel = month.count * MLA_PRIME_ANNUELLE;
  return { year: month.year, month: month.month, vehicules: month.count, annuel, mensualite: annuel / 12, moisRetrait, prixRetrait: moisRetrait * MLA_PRIME_RETRAIT_MOIS, retraits: lines };
}

const MONTHS_FR = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

/** « Octobre 2026 ». */
export function monthLabel(year: number, month: number): string {
  const name = MONTHS_FR[month - 1] ?? "";
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${year}`;
}

/** Ligne de facture MLA (texte) pour l'éditeur de facturation. */
export type MlaInvoiceRow = Record<string, string>;

/** Lignes du modèle de facture MLA : total annuel (information), mensualité, puis véhicules retirés sinistrés retenus. */
export function mlaInvoiceRows(result: MlaResult, retained: string[]): MlaInvoiceRow[] {
  const keep = new Set(retained);
  const rows: MlaInvoiceRow[] = [
    { des: "Total véhicule", qte: String(result.vehicules), pu: String(MLA_PRIME_ANNUELLE), per: `Annuel ${result.year}`, ht: String(result.annuel), info: "1" },
    { des: `Mensualité ${String(result.month).padStart(2, "0")}/12`, qte: "-", pu: "-", per: monthLabel(result.year, result.month), ht: String(result.mensualite) },
  ];
  const chosen = result.retraits.filter((line) => line.sinistre && keep.has(line.key));
  if (chosen.length) {
    rows.push({ des: "Immatriculation des véhicules retirés de la flotte", qte: "Quantité", pu: "Prime unitaire (DA) HT", per: "PÉRIODE", ht: "MONTANT HT", info: "1" });
    for (const line of chosen) rows.push({ des: line.immat, qte: "1", pu: String(result.prixRetrait), per: `${monthLabel(result.year, result.month)} – ${monthLabel(result.year, 12)}`, ht: String(result.prixRetrait) });
  }
  return rows;
}
