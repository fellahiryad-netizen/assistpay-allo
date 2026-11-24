"use server";

import { revalidatePath } from "next/cache";
import { runAction } from "@/app/actions/action-helpers";
import { envoiCancelSchema, envoiCreateSchema, envoiUpdateSchema, type EnvoiCancelInput, type EnvoiCreateValues, type EnvoiUpdateInput } from "@/features/courrier/schemas";
import { cancelEnvoi, createEnvoi, updateEnvoi } from "@/features/courrier/services/envoi-service";
import type { Envoi } from "@/features/courrier/types";
import type { ActionResult } from "@/types";

function refresh(): void {
  revalidatePath("/adresses-courrier", "layout");
}

/** Enregistrement d'un bordereau d'envoi (numéro, date et heure de création attribués par le serveur). */
export async function createEnvoiAction(input: EnvoiCreateValues): Promise<ActionResult<Envoi>> {
  const result = await runAction(envoiCreateSchema, input, createEnvoi);
  if (result.success) refresh();
  return result;
}

/** Modification de la date de ramassage, du ramasseur ou de la remarque d'un bordereau. */
export async function updateEnvoiAction(input: EnvoiUpdateInput): Promise<ActionResult<Envoi>> {
  const result = await runAction(envoiUpdateSchema, input, updateEnvoi);
  if (result.success) refresh();
  return result;
}

/** Annulation d'un bordereau, avec motif. */
export async function cancelEnvoiAction(input: EnvoiCancelInput): Promise<ActionResult<Envoi>> {
  const result = await runAction(envoiCancelSchema, input, cancelEnvoi);
  if (result.success) refresh();
  return result;
}
