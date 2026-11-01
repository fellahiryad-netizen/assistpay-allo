"use server";

import { revalidatePath } from "next/cache";
import { firstIssue, runAction, runUploadAction } from "@/app/actions/action-helpers";
import { caarBaremeSchema, caarSaveSchema, type CaarBaremeInput } from "@/features/caar/schemas";
import type { CaarBareme } from "@/features/caar/services/caar-engine";
import { previewProduction, saveBareme, saveProduction, type CaarPreview } from "@/features/caar/services/caar-service";
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

/** Enregistre (ou rétablit) le barème et les taux CAAR : administrateur uniquement. */
export async function saveCaarBaremeAction(input: CaarBaremeInput): Promise<ActionResult<CaarBareme>> {
  const result = await runAction(caarBaremeSchema, input, async (actor, data) => {
    if (data.reset) return saveBareme(actor, null);
    const hundredth = (value: number): number => Math.round(value * 100) / 10000;
    return saveBareme(actor, {
      prices: data.prices,
      coefs: data.coefs.map(hundredth),
      avFee: data.avFee,
      options: data.options,
      rates: { allo: hundredth(data.rates.allo), av: hundredth(data.rates.av), tva: hundredth(data.rates.tva) },
    });
  });
  if (result.success) revalidatePath("/caar", "layout");
  return result;
}
