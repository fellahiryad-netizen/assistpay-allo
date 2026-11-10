"use server";

import { revalidatePath } from "next/cache";
import { runAction } from "@/app/actions/action-helpers";
import { deleteIssuedSchema, prepareBillingSchema, saveBillingSchema, type PrepareBillingInput, type SaveBillingInput } from "@/features/billing/schemas";
import { deleteIssued, prepareDraft, saveDraft } from "@/features/billing/services/billing-service";
import type { BillingDraft } from "@/features/billing/types";
import type { ActionResult } from "@/types";

/** Nouvelle facture préparée (numéros, client, lignes types). */
export async function prepareBillingAction(input: PrepareBillingInput): Promise<ActionResult<BillingDraft>> {
  return runAction(prepareBillingSchema, input, prepareDraft);
}

/** Enregistrement d'une facture (ajoutée aux factures partenaires). */
export async function saveBillingAction(input: SaveBillingInput): Promise<ActionResult<{ id: string; ttc: number }>> {
  const result = await runAction(saveBillingSchema, input, saveDraft);
  if (result.success) {
    revalidatePath("/facturation", "layout");
    revalidatePath("/factures");
    revalidatePath("/bdg");
    revalidatePath("/caar");
    revalidatePath("/");
  }
  return result;
}

/** Suppression d'une facture établie (et de sa ligne au suivi si elle est en attente). */
export async function deleteIssuedAction(input: { id: string; motif: string }): Promise<ActionResult<{ num: string }>> {
  const result = await runAction(deleteIssuedSchema, input, deleteIssued);
  if (result.success) {
    revalidatePath("/facturation", "layout");
    revalidatePath("/factures");
    revalidatePath("/bdg");
    revalidatePath("/caar");
    revalidatePath("/");
  }
  return result;
}
