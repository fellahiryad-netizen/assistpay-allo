import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { requireAccess } from "@/features/access/services/access-rules";
import type { AuthUser } from "@/features/access/types";
import { currentBook, removeBranch, removeEmsContact, renameEmsSociete, saveBranch, saveEmsContact, type BookChange } from "@/features/courrier/lib/address-book";
import type { BranchInput, DeleteFicheInput, EmsContactInput, EmsSocieteInput } from "@/features/courrier/schemas";
import { COURRIER_KEY, type AddressBook, type AddressBookView, type BranchAddress, type EmsContact } from "@/features/courrier/types";
import { logAction, type JournalTrace } from "@/features/journal/services/journal-service";
import { fail, ok, type ActionResult } from "@/types";

/** Nombre de tentatives d'écriture avant d'abandonner pour cause de modifications simultanées. */
const MAX_ATTEMPTS = 5;

/** Identifiant stable d'une nouvelle fiche. */
const newFicheId = (prefix: string): string => `${prefix}-${randomUUID().slice(0, 8)}`;

/**
 * Lit, modifie puis écrit le carnet de façon sûre en cas d'accès simultanés : écriture conditionnelle sur `updatedAt` de la ligne
 * (même principe que les validations d'anomalies RH). Tant que la clé n'existe pas, la modification part de la liste de départ du code
 * et la crée ; si quelqu'un l'a créée entre-temps, on relit et on recommence.
 */
async function mutateBook<T>(compute: (book: AddressBook) => BookChange<T>): Promise<ActionResult<T>> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const row = await db.setting.findUnique({ where: { key: COURRIER_KEY } });
    const { book } = currentBook(row?.value);
    const change = compute(book);
    if (!change.ok) return fail(change.error, change.code);
    const value = JSON.parse(JSON.stringify(change.book)) as Prisma.InputJsonValue;
    const written = row
      ? (await db.setting.updateMany({ where: { key: COURRIER_KEY, updatedAt: row.updatedAt }, data: { value } })).count
      : (await db.setting.createMany({ data: [{ key: COURRIER_KEY, value }], skipDuplicates: true })).count;
    if (written === 1) return ok(change.value);
  }
  return fail("Les adresses courrier ont été modifiées en même temps par quelqu'un d'autre. Réessayez.", "CONFLICT");
}

const branchLabel = (item: Pick<BranchAddress, "compagnie" | "nom">): string => `${item.compagnie} – ${item.nom}`;

const branchValues = (item: BranchAddress | null): JournalTrace["avant"] =>
  item ? { compagnie: item.compagnie, nom: item.nom, contact: item.contact, telephones: item.telephones, adresse: item.adresse, remarque: item.remarque } : {};

const emsValues = (item: EmsContact | null): JournalTrace["avant"] =>
  item ? { nom: item.nom, role: item.role, telephone: item.telephone, email: item.email, remarque: item.remarque } : {};

/** Carnet d'adresses courrier (liste de départ du code tant que rien n'a été enregistré). Accès Partenaires en consultation. */
export async function getAddressBook(actor: AuthUser): Promise<ActionResult<AddressBookView>> {
  const guard = requireAccess(actor, "PART");
  if (!guard.success) return guard;
  try {
    const row = await db.setting.findUnique({ where: { key: COURRIER_KEY } });
    const { book, persisted } = currentBook(row?.value);
    return ok({ ...book, persisted, canEdit: requireAccess(actor, "PART", "EDIT").success });
  } catch (error) {
    console.error("[courrier] lecture impossible :", error);
    return fail("Les adresses courrier n'ont pas pu être lues.", "DATABASE");
  }
}

/** Ajoute ou modifie une succursale. Accès Partenaires en modification ; écrit dans le journal. */
export async function saveBranchAddress(actor: AuthUser, input: BranchInput): Promise<ActionResult<{ id: string }>> {
  const guard = requireAccess(actor, "PART", "EDIT");
  if (!guard.success) return guard;
  try {
    const newId = newFicheId("succ");
    const result = await mutateBook((book) => saveBranch(book, input, newId));
    if (!result.success) return result;
    const { saved, before } = result.data;
    await logAction(actor, before ? "Adresse courrier modifiée" : "Adresse courrier ajoutée", branchLabel(saved), false, {
      entity: "courrier-succursale",
      entityId: saved.id,
      avant: branchValues(before),
      apres: branchValues(saved),
    });
    return ok({ id: saved.id });
  } catch (error) {
    console.error("[courrier] enregistrement impossible :", error);
    return fail("La fiche n'a pas pu être enregistrée.", "DATABASE");
  }
}

/** Supprime une succursale. Accès Partenaires en modification ; écrit dans le journal. */
export async function deleteBranchAddress(actor: AuthUser, input: DeleteFicheInput): Promise<ActionResult<{ id: string }>> {
  const guard = requireAccess(actor, "PART", "EDIT");
  if (!guard.success) return guard;
  try {
    const result = await mutateBook((book) => removeBranch(book, input.id));
    if (!result.success) return result;
    await logAction(actor, "Adresse courrier supprimée", branchLabel(result.data), false, {
      entity: "courrier-succursale",
      entityId: result.data.id,
      avant: branchValues(result.data),
      apres: {},
    });
    return ok({ id: result.data.id });
  } catch (error) {
    console.error("[courrier] suppression impossible :", error);
    return fail("La fiche n'a pas pu être supprimée.", "DATABASE");
  }
}

/** Ajoute ou modifie une personne du prestataire de courrier. Accès Partenaires en modification ; écrit dans le journal. */
export async function saveEmsContactEntry(actor: AuthUser, input: EmsContactInput): Promise<ActionResult<{ id: string }>> {
  const guard = requireAccess(actor, "PART", "EDIT");
  if (!guard.success) return guard;
  try {
    const newId = newFicheId("ems");
    const result = await mutateBook((book) => saveEmsContact(book, input, newId));
    if (!result.success) return result;
    const { saved, before } = result.data;
    await logAction(actor, before ? "Contact courrier modifié" : "Contact courrier ajouté", `EMS – ${saved.nom}`, false, {
      entity: "courrier-ems",
      entityId: saved.id,
      avant: emsValues(before),
      apres: emsValues(saved),
    });
    return ok({ id: saved.id });
  } catch (error) {
    console.error("[courrier] enregistrement impossible :", error);
    return fail("Le contact n'a pas pu être enregistré.", "DATABASE");
  }
}

/** Supprime une personne du prestataire de courrier. Accès Partenaires en modification ; écrit dans le journal. */
export async function deleteEmsContactEntry(actor: AuthUser, input: DeleteFicheInput): Promise<ActionResult<{ id: string }>> {
  const guard = requireAccess(actor, "PART", "EDIT");
  if (!guard.success) return guard;
  try {
    const result = await mutateBook((book) => removeEmsContact(book, input.id));
    if (!result.success) return result;
    await logAction(actor, "Contact courrier supprimé", `EMS – ${result.data.nom}`, false, {
      entity: "courrier-ems",
      entityId: result.data.id,
      avant: emsValues(result.data),
      apres: {},
    });
    return ok({ id: result.data.id });
  } catch (error) {
    console.error("[courrier] suppression impossible :", error);
    return fail("Le contact n'a pas pu être supprimé.", "DATABASE");
  }
}

/** Change le nom de la société de courrier. Accès Partenaires en modification ; écrit dans le journal. */
export async function saveEmsSociete(actor: AuthUser, input: EmsSocieteInput): Promise<ActionResult<{ nom: string }>> {
  const guard = requireAccess(actor, "PART", "EDIT");
  if (!guard.success) return guard;
  try {
    const result = await mutateBook((book) => renameEmsSociete(book, input.nom));
    if (!result.success) return result;
    await logAction(actor, "Société de courrier modifiée", `${result.data.before} → ${result.data.after}`, false, {
      entity: "courrier-societe",
      entityId: "ems",
      avant: { nom: result.data.before },
      apres: { nom: result.data.after },
    });
    return ok({ nom: result.data.after });
  } catch (error) {
    console.error("[courrier] enregistrement impossible :", error);
    return fail("Le nom de la société n'a pas pu être enregistré.", "DATABASE");
  }
}
