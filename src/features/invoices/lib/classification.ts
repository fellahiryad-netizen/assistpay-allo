import type { Prisma } from "@/generated/prisma/client";

/** Valeur du paramètre `mois` pour « tous les mois ». */
export const ALL_MONTHS = "tous";
/** Valeur du paramètre `mois` pour les factures sans aucune date. */
export const NO_DATE_MONTH = "sans-date";

const MONTH_NAMES = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"] as const;

/** Ligne minimale nécessaire au classement (montants en DA, dates `AAAA-MM-JJ`). */
export interface ClassifiableRow {
  status: "EN_ATTENTE" | "REGLE" | "ANNULE";
  categorie: string;
  tiers: string;
  dateFacture: string | null;
  dateOperation: string | null;
  montant: number;
}

/** Onglet de statut simple. */
export type StatusTab = "TOUTES" | "A_REGLER" | "REGLEES";

/** Entrée d'une barre de classement : une valeur, son libellé, son nombre de factures et son total. */
export interface ClassEntry {
  /** Valeur du paramètre d'URL (chaîne vide pour « tous »). */
  value: string;
  label: string;
  count: number;
  total: number;
  active: boolean;
}

/** Classement d'une liste de factures : onglets, partenaires (ou fournisseurs) et mois. */
export interface Classification {
  /** Mois effectivement appliqué (`AAAA-MM`, `sans-date`, `tous`). */
  mois: string;
  /** Partenaire ou fournisseur appliqué (vide = tous). */
  p: string;
  tabs: Record<StatusTab, number>;
  /** Factures à régler, tous mois confondus (partenaire choisi pris en compte) : c'est ce que montre l'onglet « À régler », qui n'hérite pas du mois par défaut. */
  unpaidAllMonths: number;
  /** Première entrée = « tous », puis ordre alphabétique. */
  groups: ClassEntry[];
  /** Première entrée = « tous les mois », puis du plus récent au plus ancien, « sans date » en dernier. */
  months: ClassEntry[];
}

/** Options du calcul du classement. */
export interface ClassifyOptions {
  sens: "CREDIT" | "DEBIT";
  status?: "EN_ATTENTE" | "REGLE" | "ANNULE";
  p?: string;
  /** Mois demandé dans l'URL ; absent = mois par défaut si `useDefaultMonth`. */
  mois?: string;
  /** Appliquer le mois courant (ou le dernier mois utile) quand aucun mois n'est demandé. */
  useDefaultMonth: boolean;
  /** Mois courant `AAAA-MM`. */
  currentMonth: string;
  /** Catégories regroupées par partenaire (factures partenaires). */
  groups: Readonly<Record<string, readonly string[]>>;
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

/** Partenaire d'une facture partenaire : regroupe les catégories proches (GAM, Honoraire GAM…). */
export function partnerOf(categorie: string, groups: Readonly<Record<string, readonly string[]>>): string {
  for (const [key, categories] of Object.entries(groups)) if (categories.includes(categorie)) return key;
  return categorie || "Sans catégorie";
}

/** Nom de fournisseur normalisé : espaces de bord retirés, espaces multiples compressés, casse ignorée. */
export function normalizeSupplier(tiers: string): string {
  return tiers.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Libellé affiché pour un fournisseur sans nom. */
export const NO_SUPPLIER_LABEL = "Sans nom";

/** Clé de groupe d'un fournisseur : identique côté liste en mémoire et côté filtre de base de données. Un nom vide vaut « sans nom ». */
export function supplierKey(tiers: string): string {
  return normalizeSupplier(tiers) || normalizeSupplier(NO_SUPPLIER_LABEL);
}

/** Vrai si la valeur brute de `tiers` appartient au groupe fournisseur désigné par `wanted` (nom choisi dans la barre). */
export function matchesSupplier(tiers: string, wanted: string): boolean {
  return supplierKey(tiers) === supplierKey(wanted);
}

/** Libellé de regroupement d'une facture : partenaire (crédit) ou fournisseur (débit, espaces compressés). */
export function groupOf(row: Pick<ClassifiableRow, "categorie" | "tiers">, sens: "CREDIT" | "DEBIT", groups: Readonly<Record<string, readonly string[]>>): string {
  return sens === "CREDIT" ? partnerOf(row.categorie, groups) : row.tiers.trim().replace(/\s+/g, " ") || NO_SUPPLIER_LABEL;
}

/** Clé de groupe d'une facture (insensible à la casse et aux espaces pour les fournisseurs). */
function groupKeyOf(row: Pick<ClassifiableRow, "categorie" | "tiers">, sens: "CREDIT" | "DEBIT", groups: Readonly<Record<string, readonly string[]>>): string {
  return sens === "CREDIT" ? partnerOf(row.categorie, groups) : supplierKey(row.tiers);
}

/** Mois de rattachement `AAAA-MM` : date de facture, à défaut date de règlement, sinon `sans-date`. */
export function monthOf(row: Pick<ClassifiableRow, "dateFacture" | "dateOperation">): string {
  const date = row.dateFacture ?? row.dateOperation;
  return date && /^\d{4}-\d{2}/.test(date) ? date.slice(0, 7) : NO_DATE_MONTH;
}

/** « 2026-11 » → « Novembre 2026 » ; « sans-date » → « Sans date » ; « tous » → « Tous les mois ». */
export function monthLabel(month: string): string {
  if (month === ALL_MONTHS) return "Tous les mois";
  if (month === NO_DATE_MONTH) return "Sans date";
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  const name = match ? MONTH_NAMES[Number(match[2]) - 1] : undefined;
  return match && name ? `${name} ${match[1]}` : month;
}

/** Vrai si la valeur est un mois valide (`AAAA-MM`, `sans-date` ou `tous`). */
export function isMonthValue(value: string): boolean {
  return value === ALL_MONTHS || value === NO_DATE_MONTH || /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

/** Vrai si la ligne correspond à l'onglet de statut. */
function inStatus(row: ClassifiableRow, status: ClassifyOptions["status"]): boolean {
  return !status || row.status === status;
}

function sumBy(rows: readonly ClassifiableRow[]): { count: number; total: number } {
  return { count: rows.length, total: round2(rows.reduce((sum, row) => sum + row.montant, 0)) };
}

/** Mois par défaut : le mois courant s'il contient des factures, sinon le plus récent qui en contient, sinon « tous ». */
export function defaultMonth(rows: readonly ClassifiableRow[], currentMonth: string): string {
  const months = new Set(rows.map(monthOf));
  if (months.has(currentMonth)) return currentMonth;
  const dated = [...months].filter((month) => month !== NO_DATE_MONTH).sort().reverse();
  return dated[0] ?? ALL_MONTHS;
}

/**
 * Calcule les onglets, la barre « Partenaire / Fournisseur » et la barre « Mois » à partir des lignes visibles.
 * Chaque barre tient compte du choix fait dans l'autre et de l'onglet de statut, pour que les compteurs
 * correspondent exactement à ce que la liste affichera.
 */
export function classify(rows: readonly ClassifiableRow[], options: ClassifyOptions): Classification {
  const p = options.p ?? "";
  const keyOf = (row: ClassifiableRow): string => groupKeyOf(row, options.sens, options.groups);
  const wantedKey = options.sens === "CREDIT" ? p : supplierKey(p);
  const wantedGroup = (row: ClassifiableRow): boolean => !p || keyOf(row) === wantedKey;

  const mois = options.mois ?? (options.useDefaultMonth ? defaultMonth(rows.filter((row) => inStatus(row, options.status) && wantedGroup(row)), options.currentMonth) : ALL_MONTHS);
  const wantedMonth = (row: ClassifiableRow): boolean => mois === ALL_MONTHS || monthOf(row) === mois;

  const scoped = rows.filter((row) => wantedGroup(row) && wantedMonth(row));
  const tabs: Record<StatusTab, number> = {
    TOUTES: scoped.length,
    A_REGLER: scoped.filter((row) => row.status === "EN_ATTENTE").length,
    REGLEES: scoped.filter((row) => row.status === "REGLE").length,
  };

  const groupMap = new Map<string, { labels: Set<string>; rows: ClassifiableRow[] }>();
  for (const row of rows.filter((item) => inStatus(item, options.status) && wantedMonth(item))) {
    const key = keyOf(row);
    const entry = groupMap.get(key) ?? { labels: new Set<string>(), rows: [] };
    entry.labels.add(groupOf(row, options.sens, options.groups));
    entry.rows.push(row);
    groupMap.set(key, entry);
  }
  if (p && !groupMap.has(wantedKey)) groupMap.set(wantedKey, { labels: new Set([p]), rows: [] });
  const groupEntries: ClassEntry[] = [...groupMap.entries()]
    .map(([key, entry]) => ({ key, label: [...entry.labels].sort((a, b) => a.localeCompare(b, "fr"))[0] ?? key, rows: entry.rows }))
    .sort((a, b) => a.label.localeCompare(b.label, "fr"))
    .map((entry) => ({ value: entry.label, label: entry.label, ...sumBy(entry.rows), active: entry.key === wantedKey && p !== "" }));
  const allGroups = rows.filter((item) => inStatus(item, options.status) && wantedMonth(item));

  const monthMap = new Map<string, ClassifiableRow[]>();
  for (const row of rows.filter((item) => inStatus(item, options.status) && wantedGroup(item))) {
    const key = monthOf(row);
    monthMap.set(key, [...(monthMap.get(key) ?? []), row]);
  }
  if (mois !== ALL_MONTHS && !monthMap.has(mois)) monthMap.set(mois, []);
  const monthEntries: ClassEntry[] = [...monthMap.entries()]
    .sort(([a], [b]) => (a === NO_DATE_MONTH ? 1 : b === NO_DATE_MONTH ? -1 : b.localeCompare(a)))
    .map(([key, list]) => ({ value: key, label: monthLabel(key), ...sumBy(list), active: key === mois }));
  const allMonths = rows.filter((item) => inStatus(item, options.status) && wantedGroup(item));

  return {
    mois,
    p,
    tabs,
    unpaidAllMonths: rows.filter((row) => wantedGroup(row) && row.status === "EN_ATTENTE").length,
    groups: [{ value: "", label: options.sens === "CREDIT" ? "Tous les partenaires" : "Tous les fournisseurs", ...sumBy(allGroups), active: p === "" }, ...groupEntries],
    months: [{ value: ALL_MONTHS, label: monthLabel(ALL_MONTHS), ...sumBy(allMonths), active: mois === ALL_MONTHS }, ...monthEntries],
  };
}

/** Bornes `[début, fin[` d'un mois `AAAA-MM`, ou null si le format est invalide. */
export function monthRange(month: string): { start: Date; end: Date } | null {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!match) return null;
  const year = Number(match[1]);
  const index = Number(match[2]) - 1;
  return { start: new Date(Date.UTC(year, index, 1)), end: new Date(Date.UTC(year, index + 1, 1)) };
}

/**
 * Conditions de base de données du classement : partenaire (catégories du groupe) ou fournisseur, et mois.
 * Le mois suit la même règle que `monthOf` : date de facture, à défaut date de règlement.
 */
export function classificationConditions(
  query: { sens?: "CREDIT" | "DEBIT"; p?: string; mois?: string },
  groups: Readonly<Record<string, readonly string[]>>,
  /** Valeurs brutes de `tiers` du groupe fournisseur choisi (calculées par le service avec `matchesSupplier`) ; à défaut, repli sur une égalité insensible à la casse. */
  supplierValues?: readonly string[],
): Prisma.InvoiceWhereInput[] {
  const out: Prisma.InvoiceWhereInput[] = [];
  if (query.p && query.sens === "CREDIT") {
    const known = groups[query.p];
    const categories = known ? [...known] : [query.p === "Sans catégorie" ? "" : query.p];
    out.push({ categorie: { in: categories } });
  } else if (query.p && query.sens === "DEBIT") {
    if (supplierValues) out.push({ tiers: { in: [...supplierValues] } });
    else out.push(matchesSupplier("", query.p) ? { tiers: { in: ["", " "] } } : { tiers: { equals: query.p, mode: "insensitive" } });
  }
  if (query.mois === NO_DATE_MONTH) {
    out.push({ dateFacture: null, dateOperation: null });
  } else if (query.mois && query.mois !== ALL_MONTHS) {
    const range = monthRange(query.mois);
    if (range) {
      const within = { gte: range.start, lt: range.end };
      out.push({ OR: [{ dateFacture: within }, { dateFacture: null, dateOperation: within }] });
    }
  }
  return out;
}
