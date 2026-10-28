"use server";

import { revalidatePath } from "next/cache";
import { firstIssue, runUploadAction } from "@/app/actions/action-helpers";
import { caarSaveSchema } from "@/features/caar/schemas";
import { previewProduction, saveProduction, type CaarPreview } from "@/features/caar/services/caar-service";
import { fail, type ActionResult } from "@/types";

/** Aperçu du contrôle d'un fichier de production CAAR (rien n'est enregistré). */
export async function previewCaarAction(formData: FormData): Promise<ActionResult<CaarPreview>> {
  return runUploadAction(formData, previewProduction);
}

/** Contrôle et enregistrement d'un fichier de production CAAR. */
export async function saveCaarAction(formData: FormData): Promise<ActionResult<{ id: string }>> {
  const result = await runUploadAction(formData, async (actor, file) => {
    const options = caarSaveSchema.safeParse({ annee: formData.get("annee"), mois: formData.get("mois"), succursale: formData.get("succursale") });
    if (!options.success) return fail<{ id: string }>(firstIssue(options.error), "VALIDATION");
    return saveProduction(actor, file, options.data);
  });
  if (result.success) revalidatePath("/caar", "layout");
  return result;
}
