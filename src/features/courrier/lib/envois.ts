import { cleanText } from "@/features/courrier/lib/clean";
import {
  COURRIER_COMPANIES,
  ENVOI_KEY_PREFIX,
  ENVOI_STATUT_LABELS,
  MAX_ENVOIS_PAR_AN,
  type Envoi,
  type EnvoiFilters,
  type EnvoiLine,
  type EnvoiStatut,
  type EnvoiYear,
} from "@/features/courrier/types";
import type { ErrorCode } from "@/types";
import { daysBetween } from "@/utils/dates";
import { normalizeText } from "@/utils/text";

/** Résultat d'une modification pure d'une année de bordereaux : nouvelle année et valeur utile, ou refus. */
export type EnvoiChange<T> = { ok: true; doc: EnvoiYear; value: T } | { ok: false; error: string; code: ErrorCode };

const refuse = <T>(error: string, code: ErrorCode): EnvoiChange<T> => ({ ok: false, error, code });

/** Clé Setting d'une année. */
export const envoiKey = (year: number): string => `${ENVOI_KEY_PREFIX}${year}`;

/** Numéro « BE-AAAA-NNN » (trois chiffres au moins). */
export const formatNumero = (year: number, sequence: number): string => `BE-${year}-${String(sequence).padStart(3, "0")}`;

/** Année et rang d'un numéro « BE-AAAA-NNN », null s'il est mal formé. */
export function parseNumero(numero: string): { year: number; sequence: number } | null {
  const match = /^BE-(\d{4})-(\d{3,})$/.exec(numero);
  return match ? { year: Number(match[1]), sequence: Number(match[2]) } : null;
}

/** Jour d'Alger (`AAAA-MM-JJ`) d'un instant ISO ; chaîne vide si l'instant est illisible. */
export function algiersDay(instant: string): string {
  const date = new Date(instant);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Algiers" }).format(date);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const str = (value: unknown): string => (typeof value === "string" ? cleanText(value) : "");
const isoOrEmpty = (value: unknown): string => (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "");

function parseLine(value: unknown): EnvoiLine | null {
  if (!isRecord(value)) return null;
  const designation = str(value.designation);
  if (designation === "") return null;
  const qnt = typeof value.qnt === "number" && Number.isInteger(value.qnt) && value.qnt >= 1 ? value.qnt : 1;
  const compagnie = COURRIER_COMPANIES.find((company) => company === value.compagnie) ?? "";
  return { brancheId: str(value.brancheId), compagnie, designation, qnt, destination: str(value.destination), observation: str(value.observation) };
}

/** Statut cohérent avec les dates : annulé reste annulé, sinon ramassé si une date de ramassage existe. */
export const statutOf = (annule: boolean, ramasseLe: string): EnvoiStatut => (annule ? "ANNULE" : ramasseLe ? "RAMASSE" : "ETABLI");

/**
 * Lecture tolérante d'une année : valeur absente, ancienne ou abîmée donne une année vide ou les bordereaux lisibles, sans exception.
 * Les bordereaux sans numéro valable ou sans ligne sont ignorés ; le total est recalculé depuis les lignes ; la séquence ne descend jamais sous le plus grand numéro lu.
 */
export function parseEnvoiYear(value: unknown): EnvoiYear {
  if (!isRecord(value)) return { seq: 0, items: [] };
  const seen = new Set<string>();
  const items: Envoi[] = [];
  for (const raw of Array.isArray(value.items) ? value.items : []) {
    if (!isRecord(raw)) continue;
    const numero = typeof raw.numero === "string" ? raw.numero : "";
    const parts = parseNumero(numero);
    const lignes = (Array.isArray(raw.lignes) ? raw.lignes : []).map(parseLine).filter((line): line is EnvoiLine => line !== null);
    if (!parts || seen.has(numero) || lignes.length === 0) continue;
    seen.add(numero);
    const annule = raw.statut === "ANNULE";
    const ramasseLe = isoOrEmpty(raw.ramasseLe);
    items.push({
      numero,
      annee: parts.year,
      creeLe: str(raw.creeLe),
      creePar: str(raw.creePar),
      creeParId: str(raw.creeParId),
      date: isoOrEmpty(raw.date),
      ramasseur: str(raw.ramasseur),
      ramasseLe,
      lignes,
      total: lignes.reduce((sum, line) => sum + line.qnt, 0),
      remarque: str(raw.remarque),
      statut: statutOf(annule, ramasseLe),
      motifAnnulation: str(raw.motifAnnulation),
      annuleLe: str(raw.annuleLe),
      annulePar: str(raw.annulePar),
    });
  }
  const highest = items.reduce((max, item) => Math.max(max, parseNumero(item.numero)?.sequence ?? 0), 0);
  const stored = typeof value.seq === "number" && Number.isInteger(value.seq) && value.seq >= 0 ? value.seq : 0;
  return { seq: Math.max(stored, highest), items };
}

/** Éléments fournis à la création d'un bordereau. */
export interface EnvoiDraft {
  annee: number;
  creeLe: string;
  creePar: string;
  creeParId: string;
  date: string;
  ramasseur: string;
  remarque: string;
  lignes: EnvoiLine[];
}

/**
 * Ajoute un bordereau avec le numéro suivant de l'année. Le numéro est calculé dans la même opération que l'écriture protégée par `updatedAt` :
 * ni trou ni doublon, même avec deux utilisateurs simultanés. Refuse au-delà de 500 bordereaux par année.
 */
export function createEnvoiIn(doc: EnvoiYear, draft: EnvoiDraft): EnvoiChange<Envoi> {
  if (doc.items.length >= MAX_ENVOIS_PAR_AN) {
    return refuse(`Limite de ${MAX_ENVOIS_PAR_AN} bordereaux atteinte pour ${draft.annee} : contactez l'administrateur avant d'en établir un autre.`, "VALIDATION");
  }
  const sequence = Math.max(doc.seq, ...doc.items.map((item) => parseNumero(item.numero)?.sequence ?? 0)) + 1;
  const envoi: Envoi = {
    numero: formatNumero(draft.annee, sequence),
    annee: draft.annee,
    creeLe: draft.creeLe,
    creePar: draft.creePar,
    creeParId: draft.creeParId,
    date: draft.date,
    ramasseur: draft.ramasseur,
    ramasseLe: "",
    lignes: draft.lignes,
    total: draft.lignes.reduce((sum, line) => sum + line.qnt, 0),
    remarque: draft.remarque,
    statut: "ETABLI",
    motifAnnulation: "",
    annuleLe: "",
    annulePar: "",
  };
  return { ok: true, doc: { seq: sequence, items: [...doc.items, envoi] }, value: envoi };
}

/** Modifications permises après coup : date de ramassage, ramasseur, remarque. */
export interface EnvoiPatch {
  ramasseLe: string;
  ramasseur: string;
  remarque: string;
}

/** Modifie la date de ramassage, le ramasseur et la remarque. Un bordereau annulé ne se modifie plus ; la date de ramassage ne peut précéder la date du bordereau ni être future. */
export function updateEnvoiIn(doc: EnvoiYear, numero: string, patch: EnvoiPatch, today: string): EnvoiChange<{ before: Envoi; after: Envoi }> {
  const before = doc.items.find((item) => item.numero === numero);
  if (!before) return refuse("Ce bordereau n'existe plus. Rechargez la page.", "NOT_FOUND");
  if (before.statut === "ANNULE") return refuse("Ce bordereau est annulé : il ne peut plus être modifié.", "CONFLICT");
  if (patch.ramasseLe && patch.ramasseLe > today) return refuse("La date de ramassage ne peut pas être dans le futur.", "VALIDATION");
  if (patch.ramasseLe && before.date && patch.ramasseLe < before.date) return refuse("La date de ramassage ne peut pas précéder la date du bordereau.", "VALIDATION");
  const after: Envoi = { ...before, ramasseLe: patch.ramasseLe, ramasseur: patch.ramasseur, remarque: patch.remarque, statut: statutOf(false, patch.ramasseLe) };
  return { ok: true, doc: { ...doc, items: doc.items.map((item) => (item.numero === numero ? after : item)) }, value: { before, after } };
}

/** Annule un bordereau (motif obligatoire, conservé) ; il n'est jamais supprimé et son numéro n'est jamais réattribué. */
export function cancelEnvoiIn(doc: EnvoiYear, numero: string, motif: string, par: string, instant: string): EnvoiChange<{ before: Envoi; after: Envoi }> {
  const before = doc.items.find((item) => item.numero === numero);
  if (!before) return refuse("Ce bordereau n'existe plus. Rechargez la page.", "NOT_FOUND");
  if (before.statut === "ANNULE") return refuse("Ce bordereau est déjà annulé.", "CONFLICT");
  const after: Envoi = { ...before, statut: "ANNULE", motifAnnulation: motif, annuleLe: instant, annulePar: par };
  return { ok: true, doc: { ...doc, items: doc.items.map((item) => (item.numero === numero ? after : item)) }, value: { before, after } };
}

/** Tous les bordereaux de plusieurs années, du plus récent au plus ancien (numéro décroissant). */
export function sortByNumeroDesc(items: readonly Envoi[]): Envoi[] {
  return [...items].sort((a, b) => b.annee - a.annee || (parseNumero(b.numero)?.sequence ?? 0) - (parseNumero(a.numero)?.sequence ?? 0));
}

/** Filtres vides. */
export const EMPTY_FILTERS: EnvoiFilters = { q: "", du: "", au: "", ramasse: "", statut: "", compagnie: "" };

/** Applique les filtres : texte (numéro, désignation, destination, ramasseur, remarque, créateur), période de création (jour d'Alger), ramassé ou non, statut, compagnie. */
export function filterEnvois(items: readonly Envoi[], filters: EnvoiFilters): Envoi[] {
  const needle = normalizeText(filters.q);
  return items.filter((item) => {
    const day = algiersDay(item.creeLe);
    if (filters.du && (!day || day < filters.du)) return false;
    if (filters.au && (!day || day > filters.au)) return false;
    if (filters.ramasse === "oui" && !item.ramasseLe) return false;
    if (filters.ramasse === "non" && item.ramasseLe) return false;
    if (filters.statut && item.statut !== filters.statut) return false;
    if (filters.compagnie && !item.lignes.some((line) => line.compagnie === filters.compagnie)) return false;
    if (!needle) return true;
    const haystack = [item.numero, item.ramasseur, item.remarque, item.creePar, ...item.lignes.flatMap((line) => [line.designation, line.destination, line.observation])].join(" ");
    return normalizeText(haystack).includes(needle);
  });
}

/** Critères de tri de l'historique. */
export const ENVOI_SORTS = ["numero-desc", "numero-asc", "creation-desc", "creation-asc", "ramassage-desc", "ramassage-asc"] as const;
/** Critère de tri de l'historique. */
export type EnvoiSort = (typeof ENVOI_SORTS)[number];

/** Trie sans modifier la liste d'origine ; les bordereaux sans date de ramassage passent après les autres (tri récent) ou avant (tri ancien). */
export function sortEnvois(items: readonly Envoi[], sort: EnvoiSort): Envoi[] {
  const byNumero = (a: Envoi, b: Envoi): number => a.annee - b.annee || (parseNumero(a.numero)?.sequence ?? 0) - (parseNumero(b.numero)?.sequence ?? 0);
  const list = [...items];
  switch (sort) {
    case "numero-asc":
      return list.sort(byNumero);
    case "creation-desc":
      return list.sort((a, b) => b.creeLe.localeCompare(a.creeLe) || byNumero(b, a));
    case "creation-asc":
      return list.sort((a, b) => a.creeLe.localeCompare(b.creeLe) || byNumero(a, b));
    case "ramassage-desc":
      return list.sort((a, b) => (a.ramasseLe === "") !== (b.ramasseLe === "") ? (a.ramasseLe === "" ? 1 : -1) : b.ramasseLe.localeCompare(a.ramasseLe) || byNumero(b, a));
    case "ramassage-asc":
      return list.sort((a, b) => (a.ramasseLe === "") !== (b.ramasseLe === "") ? (a.ramasseLe === "" ? -1 : 1) : a.ramasseLe.localeCompare(b.ramasseLe) || byNumero(a, b));
    default:
      return list.sort((a, b) => byNumero(b, a));
  }
}

/** Page `page` (à partir de 1) d'une liste ; la page est ramenée dans les bornes. */
export function paginate<T>(items: readonly T[], page: number, size: number): { items: T[]; page: number; pageCount: number } {
  const pageCount = Math.max(1, Math.ceil(items.length / size));
  const current = Math.min(Math.max(1, page), pageCount);
  return { items: items.slice((current - 1) * size, current * size), page: current, pageCount };
}

/** Dernier envoi par fiche : date du bordereau (la plus récente) parmi les bordereaux non annulés. */
export function lastSentByBranch(items: readonly Envoi[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const item of items) {
    if (item.statut === "ANNULE" || !item.date) continue;
    for (const line of item.lignes) {
      if (line.brancheId && (result[line.brancheId] ?? "") < item.date) result[line.brancheId] = item.date;
    }
  }
  return result;
}

/** Délai (en jours) après lequel un bordereau sans date de ramassage est signalé. */
export const PICKUP_ALERT_DAYS = 2;

/** Bordereaux établis, non annulés, sans date de ramassage depuis plus de 2 jours (jour de création à Alger). */
export function overdueEnvois(items: readonly Envoi[], today: string): Envoi[] {
  return items.filter((item) => {
    if (item.statut !== "ETABLI" || item.ramasseLe) return false;
    const day = algiersDay(item.creeLe);
    return day !== "" && daysBetween(day, today) > PICKUP_ALERT_DAYS;
  });
}

/** Titres des colonnes de l'export Excel. */
export const ENVOI_EXPORT_HEADER = ["N°", "Date de création", "Date du bordereau", "Date de ramassage", "Ramasseur", "Compagnie", "Succursale", "Destination", "Quantité", "Observation", "Statut", "Créé par"] as const;

const frDate = (iso: string): string => {
  const [year = "", month = "", day = ""] = iso.split("-");
  return iso ? `${day}/${month}/${year}` : "";
};

/** Date et heure d'Alger « JJ/MM/AAAA HH:MM » d'un instant ISO. */
export function algiersDateTime(instant: string): string {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("fr-FR", { timeZone: "Africa/Algiers", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const get = (type: string): string => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("day")}/${get("month")}/${get("year")} ${get("hour")}:${get("minute")}`;
}

/** Lignes de l'export : une par succursale envoyée (N°, création, ramassage, ramasseur, succursale, destination, quantité, observation, statut). */
export function envoisToRows(items: readonly Envoi[]): Array<Array<string | number | null>> {
  return items.flatMap((item) =>
    item.lignes.map((line) => [
      item.numero,
      algiersDateTime(item.creeLe),
      frDate(item.date),
      frDate(item.ramasseLe),
      item.ramasseur,
      line.compagnie,
      line.designation,
      line.destination,
      line.qnt,
      line.observation,
      ENVOI_STATUT_LABELS[item.statut],
      item.creePar,
    ]),
  );
}
