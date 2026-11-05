"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runAction } from "@/app/actions/action-helpers";
import { fpCreate, fpMove, fpNote, fpSavePrest, type FpCreateInput, type FpMoveInput, type FpPrestInput } from "@/features/provider-invoices/services/fp-store";
import type { FpRequest } from "@/features/provider-invoices/services/fp-engine";
import type { ActionResult } from "@/types";

const any = z.record(z.string(), z.unknown());
function refresh(): void {
  revalidatePath("/factures-prestataires");
  revalidatePath("/", "layout");
}

/** Enregistre une demande de facture prestataire. */
export async function fpCreateAction(input: FpCreateInput): Promise<ActionResult<FpRequest>> {
  const result = await runAction(any, input, (actor, data) => fpCreate(actor, data as unknown as FpCreateInput));
  if (result.success) refresh();
  return result;
}

/** Change l'étape d'une facture prestataire. */
export async function fpMoveAction(input: FpMoveInput): Promise<ActionResult<FpRequest>> {
  const result = await runAction(any, input, (actor, data) => fpMove(actor, data as unknown as FpMoveInput));
  if (result.success) refresh();
  return result;
}

/** Enregistre l'observation d'une facture. */
export async function fpNoteAction(input: { id: string; obs: string }): Promise<ActionResult<true>> {
  const result = await runAction(any, input, (actor, data) => fpNote(actor, data as unknown as { id: string; obs: string }));
  if (result.success) refresh();
  return result;
}

/** Ajoute ou modifie un prestataire de la liste d'envoi. */
export async function fpSavePrestAction(input: FpPrestInput): Promise<ActionResult<true>> {
  const result = await runAction(any, input, (actor, data) => fpSavePrest(actor, data as unknown as FpPrestInput));
  if (result.success) refresh();
  return result;
}
