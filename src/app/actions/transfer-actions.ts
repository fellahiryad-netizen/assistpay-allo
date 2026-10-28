"use server";

import { revalidatePath } from "next/cache";
import { firstIssue, runAction, runUploadAction } from "@/app/actions/action-helpers";
import {
  decideBatchSchema,
  ribActionSchema,
  ribSaveSchema,
  sheetSchema,
  uploadCheckSchema,
  type DecideBatchInput,
  type RibActionInput,
  type RibSaveInput,
  type SheetInput,
} from "@/features/transfers/schemas";
import { ribAction, saveRib } from "@/features/transfers/services/rib-service";
import { checkUploadedFile, computeSheet, decideBatch, generateSheet } from "@/features/transfers/services/transfer-service";
import type { SheetLine } from "@/features/transfers/types";
import { fail, type ActionResult } from "@/types";

function refresh(): void {
  revalidatePath("/virements", "layout");
  revalidatePath("/demandes");
  revalidatePath("/releve", "layout");
}

/** Contrôle d'un fichier de virements déposé. */
export async function checkTransferFileAction(formData: FormData): Promise<ActionResult<{ id: string }>> {
  const result = await runUploadAction(formData, async (actor, file) => {
    const options = uploadCheckSchema.safeParse({ type: formData.get("type"), mois: formData.get("mois"), annee: formData.get("annee") });
    if (!options.success) return fail<{ id: string }>(firstIssue(options.error), "VALIDATION");
    return checkUploadedFile(actor, file, options.data);
  });
  if (result.success) refresh();
  return result;
}

/** Validation / rejet / mise en attente d'un envoi. */
export async function decideBatchAction(input: DecideBatchInput): Promise<ActionResult<{ added: number; changes: number }>> {
  const result = await runAction(decideBatchSchema, input, decideBatch);
  if (result.success) refresh();
  return result;
}

/** Calcul des lignes de l'état des virements. */
export async function computeSheetAction(input: SheetInput): Promise<ActionResult<{ lines: SheetLine[]; total: number; transfers: number; problems: number }>> {
  return runAction(sheetSchema, input, computeSheet);
}

/** Génération de l'état des virements. */
export async function generateSheetAction(input: SheetInput): Promise<ActionResult<{ batchId: string; name: string }>> {
  const result = await runAction(sheetSchema, input, generateSheet);
  if (result.success) refresh();
  return result;
}

/** Action sur un compte du référentiel RIB. */
export async function ribActionAction(input: RibActionInput): Promise<ActionResult<string>> {
  const result = await runAction(ribActionSchema, input, ribAction);
  if (result.success) refresh();
  return result;
}

/** Ajout / modification d'un compte du référentiel. */
export async function saveRibAction(input: RibSaveInput): Promise<ActionResult<{ id: string }>> {
  const result = await runAction(ribSaveSchema, input, saveRib);
  if (result.success) refresh();
  return result;
}
