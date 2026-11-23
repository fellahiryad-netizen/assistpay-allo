import { cleanText } from "@/features/courrier/lib/clean";
import { buildDefaultBook } from "@/features/courrier/lib/seed";
import type { BranchInput, EmsContactInput } from "@/features/courrier/schemas";
import {
  COURRIER_COMPANIES,
  EMS_ROLES,
  MAX_FICHES,
  type AddressBook,
  type BranchAddress,
  type CourrierCompany,
  type EmsContact,
  type EmsRole,
} from "@/features/courrier/types";
import type { ErrorCode } from "@/types";
import { normalizeText } from "@/utils/text";

/** Résultat d'une modification pure du carnet : nouveau carnet et valeur utile, ou refus. */
export type BookChange<T> = { ok: true; book: AddressBook; value: T } | { ok: false; error: string; code: ErrorCode };

const refuse = <T>(error: string, code: ErrorCode): BookChange<T> => ({ ok: false, error, code });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const str = (value: unknown): string => (typeof value === "string" ? cleanText(value) : "");

/** Identifiant libre : l'identifiant lu s'il est valable et pas déjà pris, sinon un identifiant dérivé de la position. */
function uniqueId(raw: unknown, taken: Set<string>, prefix: string, index: number): string {
  const wanted = typeof raw === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(raw) ? raw : `${prefix}-lu-${index + 1}`;
  let candidate = wanted;
  let n = 2;
  while (taken.has(candidate)) {
    candidate = `${wanted}-${n}`;
    n += 1;
  }
  taken.add(candidate);
  return candidate;
}

/**
 * Lecture tolérante du réglage : renvoie null si la valeur n'est pas un objet (le carnet de départ du code s'applique alors).
 * Les fiches illisibles (pas de nom, compagnie inconnue) sont ignorées ; aucune exception n'est levée.
 */
export function parseAddressBook(value: unknown): AddressBook | null {
  if (!isRecord(value)) return null;
  const taken = new Set<string>();
  const branches: BranchAddress[] = [];
  (Array.isArray(value.branches) ? value.branches : []).forEach((item: unknown, index: number) => {
    if (!isRecord(item)) return;
    const compagnie = COURRIER_COMPANIES.find((company) => company === item.compagnie);
    const nom = str(item.nom);
    if (!compagnie || nom === "") return;
    branches.push({ id: uniqueId(item.id, taken, "succ", index), compagnie, nom, contact: str(item.contact), telephones: str(item.telephones), adresse: str(item.adresse), remarque: str(item.remarque) });
  });
  const contacts: EmsContact[] = [];
  (Array.isArray(value.emsContacts) ? value.emsContacts : []).forEach((item: unknown, index: number) => {
    if (!isRecord(item)) return;
    const nom = str(item.nom);
    if (nom === "") return;
    const role: EmsRole = EMS_ROLES.find((candidate) => candidate === item.role) ?? "RECLAMATION";
    contacts.push({ id: uniqueId(item.id, taken, "ems", index), nom, role, telephone: str(item.telephone), email: str(item.email).toLowerCase(), remarque: str(item.remarque) });
  });
  return { branches, emsSociete: str(value.emsSociete) || "EMS", emsContacts: contacts };
}

/** Carnet courant : celui du réglage s'il existe, sinon la liste de départ du code. */
export function currentBook(stored: unknown): { book: AddressBook; persisted: boolean } {
  const parsed = parseAddressBook(stored);
  return parsed ? { book: parsed, persisted: true } : { book: buildDefaultBook(), persisted: false };
}

/** Nombre de fiches (succursales et contacts EMS). */
export const ficheCount = (book: AddressBook): number => book.branches.length + book.emsContacts.length;

const sameName = (a: string, b: string): boolean => normalizeText(a) === normalizeText(b);

/** Ajoute une succursale (si `input.id` est absent) ou modifie celle qui porte cet identifiant. `newId` sert pour un ajout. */
export function saveBranch(book: AddressBook, input: BranchInput, newId: string): BookChange<{ saved: BranchAddress; before: BranchAddress | null }> {
  const id = input.id ?? newId;
  const before = book.branches.find((item) => item.id === id) ?? null;
  if (input.id && !before) return refuse("Cette fiche n'existe plus (elle a été supprimée par quelqu'un d'autre). Rechargez la page.", "NOT_FOUND");
  if (book.branches.some((item) => item.id !== id && item.compagnie === input.compagnie && sameName(item.nom, input.nom))) {
    return refuse(`Une fiche « ${input.nom} » existe déjà pour ${input.compagnie}. Modifiez-la plutôt que d'en créer une seconde.`, "CONFLICT");
  }
  if (!before && ficheCount(book) >= MAX_FICHES) return refuse(`Limite de ${MAX_FICHES} fiches atteinte : supprimez une fiche inutile avant d'en ajouter.`, "VALIDATION");
  const saved: BranchAddress = { id, compagnie: input.compagnie, nom: input.nom, contact: input.contact, telephones: input.telephones, adresse: input.adresse, remarque: input.remarque };
  const branches = before ? book.branches.map((item) => (item.id === id ? saved : item)) : [...book.branches, saved];
  return { ok: true, book: { ...book, branches }, value: { saved, before } };
}

/** Supprime une succursale. */
export function removeBranch(book: AddressBook, id: string): BookChange<BranchAddress> {
  const found = book.branches.find((item) => item.id === id);
  if (!found) return refuse("Cette fiche n'existe plus (elle a déjà été supprimée). Rechargez la page.", "NOT_FOUND");
  return { ok: true, book: { ...book, branches: book.branches.filter((item) => item.id !== id) }, value: found };
}

/** Ajoute ou modifie une personne du prestataire de courrier. */
export function saveEmsContact(book: AddressBook, input: EmsContactInput, newId: string): BookChange<{ saved: EmsContact; before: EmsContact | null }> {
  const id = input.id ?? newId;
  const before = book.emsContacts.find((item) => item.id === id) ?? null;
  if (input.id && !before) return refuse("Cette fiche n'existe plus (elle a été supprimée par quelqu'un d'autre). Rechargez la page.", "NOT_FOUND");
  if (book.emsContacts.some((item) => item.id !== id && sameName(item.nom, input.nom))) {
    return refuse(`« ${input.nom} » figure déjà parmi les contacts du prestataire de courrier.`, "CONFLICT");
  }
  if (!before && ficheCount(book) >= MAX_FICHES) return refuse(`Limite de ${MAX_FICHES} fiches atteinte : supprimez une fiche inutile avant d'en ajouter.`, "VALIDATION");
  const saved: EmsContact = { id, nom: input.nom, role: input.role, telephone: input.telephone, email: input.email, remarque: input.remarque };
  const emsContacts = before ? book.emsContacts.map((item) => (item.id === id ? saved : item)) : [...book.emsContacts, saved];
  return { ok: true, book: { ...book, emsContacts }, value: { saved, before } };
}

/** Supprime une personne du prestataire de courrier. */
export function removeEmsContact(book: AddressBook, id: string): BookChange<EmsContact> {
  const found = book.emsContacts.find((item) => item.id === id);
  if (!found) return refuse("Cette fiche n'existe plus (elle a déjà été supprimée). Rechargez la page.", "NOT_FOUND");
  return { ok: true, book: { ...book, emsContacts: book.emsContacts.filter((item) => item.id !== id) }, value: found };
}

/** Change le nom de la société de courrier. */
export function renameEmsSociete(book: AddressBook, nom: string): BookChange<{ before: string; after: string }> {
  return { ok: true, book: { ...book, emsSociete: nom }, value: { before: book.emsSociete, after: nom } };
}

/** Succursales demandées pour l'impression, dans l'ordre demandé ; les identifiants inconnus sont ignorés. */
export function pickBranches(branches: readonly BranchAddress[], ids: readonly string[]): BranchAddress[] {
  const byId = new Map(branches.map((item) => [item.id, item]));
  return ids.map((id) => byId.get(id)).filter((item): item is BranchAddress => item !== undefined);
}

/** Filtre de la liste : compagnie (ou toutes) et recherche sans accent ni casse dans le nom, le contact, le téléphone, l'adresse et la remarque. */
export function filterBranches(branches: readonly BranchAddress[], company: CourrierCompany | "", query: string): BranchAddress[] {
  const needle = normalizeText(query);
  return branches.filter((item) => {
    if (company && item.compagnie !== company) return false;
    if (!needle) return true;
    return normalizeText(`${item.compagnie} ${item.nom} ${item.contact} ${item.telephones} ${item.adresse} ${item.remarque}`).includes(needle);
  });
}

const ROMAN: Readonly<Record<string, string>> = { I: "1", II: "2", III: "3" };

/** Clé de comparaison d'une succursale : sans accent, majuscules, sans « SUCCURSALE » ni compagnie, code à trois chiffres final retiré, « ALGER II » écrit « ALGER 2 ». */
function branchKey(text: string, company: CourrierCompany): string {
  const words = normalizeText(text)
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter((word) => word !== "" && word !== "SUCCURSALE" && word !== company);
  const last = words.at(-1);
  if (words.length > 1 && last && /^\d{3}$/.test(last)) words.pop();
  return words.map((word) => ROMAN[word] ?? word).join(" ");
}

/**
 * Retrouve la fiche courrier d'une succursale à partir de la clé du partenaire (« CAAR », « CAAT ») et du nom de succursale
 * des factures (`branchOf`, ex. « ORAN », « ALGER II »). Comparaison exacte des noms normalisés ; renvoie null s'il y a zéro ou plusieurs fiches (jamais de choix au hasard).
 */
export function matchBranch(branches: readonly BranchAddress[], partnerKey: string, invoiceBranch: string): BranchAddress | null {
  const company = COURRIER_COMPANIES.find((value) => new RegExp(`^${value}(\\s|$)`).test(normalizeText(partnerKey).toUpperCase()));
  if (!company || invoiceBranch.trim() === "") return null;
  const wanted = branchKey(invoiceBranch, company);
  if (wanted === "") return null;
  const found = branches.filter((item) => item.compagnie === company && branchKey(item.nom, company) === wanted);
  return found.length === 1 ? (found[0] ?? null) : null;
}
