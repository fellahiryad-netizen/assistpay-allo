"use server";

import { revalidatePath } from "next/cache";
import { runUploadAction } from "@/app/actions/action-helpers";
import { applyGamImport, previewGamImport, type GamCreated, type GamImportPreview } from "@/features/billing/services/gam-import";
import type { ActionResult } from "@/types";

/** Lecture du fichier système BDG GAM : séparation conventionnel / Takaful et contrôle des totaux (rien n'est enregistré). */
export async function previewGamImportAction(formData: FormData): Promise<ActionResult<GamImportPreview>> {
  return runUploadAction(formData, (actor, file) => previewGamImport(actor, file.bytes));
}

/** Création des deux factures globales BDG GAM depuis le fichier système (champs « per » AAAA-MM et « date » AAAA-MM-JJ). */
export async function applyGamImportAction(formData: FormData): Promise<ActionResult<GamCreated[]>> {
  const result = await runUploadAction(formData, (actor, file) =>
    applyGamImport(actor, file.bytes, { per: String(formData.get("per") ?? ""), date: String(formData.get("date") ?? "") }),
  );
  if (result.success) {
    revalidatePath("/facturation", "layout");
    revalidatePath("/factures");
    revalidatePath("/bdg");
    revalidatePath("/");
  }
  return result;
}
