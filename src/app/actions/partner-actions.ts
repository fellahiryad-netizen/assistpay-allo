"use server";

import { revalidatePath } from "next/cache";
import { runAction } from "@/app/actions/action-helpers";
import { partnerQuerySchema, type PartnerQuery } from "@/features/partners/schemas";
import { recordReminder } from "@/features/partners/services/partner-service";
import type { ActionResult } from "@/types";

/** Enregistrement d'une relance partenaire (avant impression de la lettre). */
export async function recordReminderAction(input: PartnerQuery): Promise<ActionResult<{ count: number; total: number }>> {
  const result = await runAction(partnerQuerySchema, input, recordReminder);
  if (result.success) revalidatePath("/partenaires", "layout");
  return result;
}
