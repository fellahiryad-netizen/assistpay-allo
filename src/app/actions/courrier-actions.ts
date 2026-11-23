"use server";

import { revalidatePath } from "next/cache";
import { runAction } from "@/app/actions/action-helpers";
import { branchSchema, deleteFicheSchema, emsContactSchema, emsSocieteSchema, type BranchFormValues, type DeleteFicheInput, type EmsContactFormValues, type EmsSocieteInput } from "@/features/courrier/schemas";
import { deleteBranchAddress, deleteEmsContactEntry, saveBranchAddress, saveEmsContactEntry, saveEmsSociete } from "@/features/courrier/services/courrier-service";
import type { ActionResult } from "@/types";

function refresh(): void {
  revalidatePath("/adresses-courrier");
}

/** Ajout ou modification d'une succursale destinataire du courrier. */
export async function saveBranchAddressAction(input: BranchFormValues): Promise<ActionResult<{ id: string }>> {
  const result = await runAction(branchSchema, input, saveBranchAddress);
  if (result.success) refresh();
  return result;
}

/** Suppression d'une succursale. */
export async function deleteBranchAddressAction(input: DeleteFicheInput): Promise<ActionResult<{ id: string }>> {
  const result = await runAction(deleteFicheSchema, input, deleteBranchAddress);
  if (result.success) refresh();
  return result;
}

/** Ajout ou modification d'une personne du prestataire de courrier. */
export async function saveEmsContactAction(input: EmsContactFormValues): Promise<ActionResult<{ id: string }>> {
  const result = await runAction(emsContactSchema, input, saveEmsContactEntry);
  if (result.success) refresh();
  return result;
}

/** Suppression d'une personne du prestataire de courrier. */
export async function deleteEmsContactAction(input: DeleteFicheInput): Promise<ActionResult<{ id: string }>> {
  const result = await runAction(deleteFicheSchema, input, deleteEmsContactEntry);
  if (result.success) refresh();
  return result;
}

/** Changement du nom de la société de courrier. */
export async function saveEmsSocieteAction(input: EmsSocieteInput): Promise<ActionResult<{ nom: string }>> {
  const result = await runAction(emsSocieteSchema, input, saveEmsSociete);
  if (result.success) refresh();
  return result;
}
