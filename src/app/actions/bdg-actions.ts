"use server";

import { revalidatePath } from "next/cache";
import { firstIssue, runAction, runUploadAction } from "@/app/actions/action-helpers";
import { etatsOptionsSchema, settlePartSchema, type SettlePartInput } from "@/features/bdg/schemas";
import { settleBdgPart } from "@/features/bdg/services/bdg-service";
import { exportEtatsAgences, previewEtatsAgences, type EtatsAgences } from "@/features/bdg/services/etats-agences";
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

function etatsOptions(formData: FormData): ReturnType<typeof etatsOptionsSchema.safeParse> {
  return etatsOptionsSchema.safeParse({ tva: formData.get("tva") ?? undefined, exclure: formData.get("exclure") ?? undefined, mois: formData.get("mois") ?? undefined, logo: formData.get("logo") ?? undefined, mh: formData.get("mh") ?? undefined, mb: formData.get("mb") ?? undefined, only: formData.get("only") ?? undefined });
}

/** Aperçu des états par agence d'un fichier de factures BDG CAAT (rien n'est enregistré). */
export async function previewEtatsAgencesAction(formData: FormData): Promise<ActionResult<EtatsAgences>> {
  return runUploadAction(formData, async (actor, file) => {
    const options = etatsOptions(formData);
    if (!options.success) return fail<EtatsAgences>(firstIssue(options.error), "VALIDATION");
    return previewEtatsAgences(actor, file, options.data);
  });
}

/** Classeur Excel des états par agence (récapitulatif général et une feuille par agence). */
export async function exportEtatsAgencesAction(formData: FormData): Promise<ActionResult<{ filename: string; base64: string }>> {
  return runUploadAction(formData, async (actor, file) => {
    const options = etatsOptions(formData);
    if (!options.success) return fail<{ filename: string; base64: string }>(firstIssue(options.error), "VALIDATION");
    return exportEtatsAgences(actor, file, options.data);
  });
}
