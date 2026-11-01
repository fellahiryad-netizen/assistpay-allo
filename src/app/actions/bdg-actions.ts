"use server";

import { revalidatePath } from "next/cache";
import { firstIssue, runAction, runUploadAction } from "@/app/actions/action-helpers";
import { gamOptionsSchema, settlePartSchema, type SettlePartInput } from "@/features/bdg/schemas";
import { settleBdgPart } from "@/features/bdg/services/bdg-service";
import { exportGamEtats, previewGamEtats, type GamEtats } from "@/features/bdg/services/gam-etats";
import { fail, type ActionResult } from "@/types";

/** Règlement d'une partie d'une facture BDG. */
export async function settleBdgPartAction(input: SettlePartInput): Promise<ActionResult<{ settled: boolean }>> {
  const result = await runAction(settlePartSchema, input, settleBdgPart);
  if (result.success) {
    revalidatePath("/bdg");
    revalidatePath("/factures");
    revalidatePath("/");
  }
  return result;
}

function gamOptions(formData: FormData): ReturnType<typeof gamOptionsSchema.safeParse> {
  return gamOptionsSchema.safeParse({ tva: formData.get("tva") ?? undefined, exclure: formData.get("exclure") ?? undefined, mois: formData.get("mois") ?? undefined });
}

/** Aperçu des états par agence d'un fichier de factures BDG GAM (rien n'est enregistré). */
export async function previewGamEtatsAction(formData: FormData): Promise<ActionResult<GamEtats>> {
  return runUploadAction(formData, async (actor, file) => {
    const options = gamOptions(formData);
    if (!options.success) return fail<GamEtats>(firstIssue(options.error), "VALIDATION");
    return previewGamEtats(actor, file, options.data);
  });
}

/** Classeur Excel des états par agence (récapitulatif général et une feuille par agence). */
export async function exportGamEtatsAction(formData: FormData): Promise<ActionResult<{ filename: string; base64: string }>> {
  return runUploadAction(formData, async (actor, file) => {
    const options = gamOptions(formData);
    if (!options.success) return fail<{ filename: string; base64: string }>(firstIssue(options.error), "VALIDATION");
    return exportGamEtats(actor, file, options.data);
  });
}
