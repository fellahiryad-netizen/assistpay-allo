"use server";

import { revalidatePath } from "next/cache";
import { runAction } from "@/app/actions/action-helpers";
import { changeProviderActivitySchema, type ChangeProviderActivityInput } from "@/features/invoices/schemas";
import { changeProviderActivity } from "@/features/invoices/services/provider-activity-service";
import type { ActionResult } from "@/types";

/** Change l'activité (assistance, BDG, autre) des factures impayées d'un prestataire. */
export async function changeProviderActivityAction(input: ChangeProviderActivityInput): Promise<ActionResult<{ changed: number }>> {
  const result = await runAction(changeProviderActivitySchema, input, changeProviderActivity);
  if (result.success) {
    revalidatePath("/prestataires");
    revalidatePath("/factures");
  }
  return result;
}
