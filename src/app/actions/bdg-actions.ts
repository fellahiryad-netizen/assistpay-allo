"use server";

import { revalidatePath } from "next/cache";
import { runAction } from "@/app/actions/action-helpers";
import { settlePartSchema, type SettlePartInput } from "@/features/bdg/schemas";
import { settleBdgPart } from "@/features/bdg/services/bdg-service";
import type { ActionResult } from "@/types";

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
