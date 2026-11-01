"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runAction } from "@/app/actions/action-helpers";
import { decideDeletion, requestDeletion } from "@/features/invoices/services/deletion-service";
import type { ActionResult } from "@/types";

const requestSchema = z.object({ kind: z.enum(["facture", "etablie"]), id: z.string().min(1).max(64), motif: z.string().trim().max(300).default("") });
const decideSchema = z.object({ id: z.string().min(1).max(64), approve: z.boolean(), note: z.string().trim().max(300).default("") });

function refresh(): void {
  revalidatePath("/", "layout");
}

/** Demande de suppression d'une facture (validée ensuite par un administrateur ; directe pour un administrateur). */
export async function requestDeletionAction(input: z.input<typeof requestSchema>): Promise<ActionResult<{ done: boolean }>> {
  const result = await runAction(requestSchema, input, requestDeletion);
  if (result.success) refresh();
  return result;
}

/** Validation ou refus d'une demande de suppression (administrateur). */
export async function decideDeletionAction(input: z.input<typeof decideSchema>): Promise<ActionResult<{ approved: boolean }>> {
  const result = await runAction(decideSchema, input, decideDeletion);
  if (result.success) refresh();
  return result;
}
