"use server";

import { revalidatePath } from "next/cache";
import { runAction } from "@/app/actions/action-helpers";
import { hrDeleteSchema, hrEntrySchema, type HrEntryInput } from "@/features/hr/schemas";
import { deleteHrEntry, saveHrEntry } from "@/features/hr/services/hr-service";
import type { ActionResult } from "@/types";

function refresh(): void {
  revalidatePath("/rh");
  revalidatePath("/factures");
  revalidatePath("/pilotage");
}

/** Création ou modification d'une saisie RH. */
export async function saveHrEntryAction(input: HrEntryInput): Promise<ActionResult<{ id: string }>> {
  const result = await runAction(hrEntrySchema, input, saveHrEntry);
  if (result.success) refresh();
  return result;
}

/** Suppression d'une saisie RH. */
export async function deleteHrEntryAction(input: { id: string }): Promise<ActionResult<{ id: string }>> {
  const result = await runAction(hrDeleteSchema, input, deleteHrEntry);
  if (result.success) refresh();
  return result;
}
