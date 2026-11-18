"use server";

import { revalidatePath } from "next/cache";
import { runAction } from "@/app/actions/action-helpers";
import { cancelAvoirSchema, createAvoirSchema, type CancelAvoirInput, type CreateAvoirInput } from "@/features/avoirs/schemas";
import { cancelAvoir, createAvoir } from "@/features/avoirs/services/avoir-service";
import type { ActionResult } from "@/types";

/** Établit un avoir sur une facture déjà émise. */
export async function createAvoirAction(input: CreateAvoirInput): Promise<ActionResult<{ id: string; num: string }>> {
  const result = await runAction(createAvoirSchema, input, createAvoir);
  if (result.success) {
    revalidatePath("/avoirs", "layout");
    revalidatePath("/factures", "layout");
  }
  return result;
}

/** Annule un avoir (le numéro reste dans la série). */
export async function cancelAvoirAction(input: CancelAvoirInput): Promise<ActionResult<{ num: string }>> {
  const result = await runAction(cancelAvoirSchema, input, cancelAvoir);
  if (result.success) {
    revalidatePath("/avoirs", "layout");
    revalidatePath("/factures", "layout");
  }
  return result;
}
