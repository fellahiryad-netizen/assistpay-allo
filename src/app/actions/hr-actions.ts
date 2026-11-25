"use server";

import { revalidatePath } from "next/cache";
import { runAction } from "@/app/actions/action-helpers";
import type { HrDetailDTO } from "@/features/hr/types";
import { hrAnomaliesValidateSchema, hrAssignSchema, hrDetailSchema, type HrAssignInput, hrAnomalyRestoreSchema, hrAnomalyValidateSchema, hrDeleteSchema, hrEntrySchema, type HrEntryInput } from "@/features/hr/schemas";
import { assignHrEntryToLine, deleteHrEntry, getHrEntryDetail, unlinkHrEntryFromLines, restoreHrAnomaly, saveHrEntry, validateHrAnomalies } from "@/features/hr/services/hr-service";
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

/** Validation d'une anomalie RH (« j'ai vérifié, c'est normal »), avec un motif facultatif. */
export async function validateHrAnomalyAction(input: { key: string; motif?: string }): Promise<ActionResult<{ done: number }>> {
  const result = await runAction(hrAnomalyValidateSchema, input, (actor, value) => validateHrAnomalies(actor, { keys: [value.key], motif: value.motif }));
  if (result.success) refresh();
  return result;
}

/** Validation en bloc d'anomalies RH : un seul motif, une seule écriture du réglage, une seule ligne de journal. */
export async function validateHrAnomaliesAction(input: { keys: string[]; motif?: string }): Promise<ActionResult<{ done: number }>> {
  const result = await runAction(hrAnomaliesValidateSchema, input, validateHrAnomalies);
  if (result.success) refresh();
  return result;
}

/** Rétablissement d'une anomalie validée. */
export async function restoreHrAnomalyAction(input: { key: string }): Promise<ActionResult<{ key: string }>> {
  const result = await runAction(hrAnomalyRestoreSchema, input, restoreHrAnomaly);
  if (result.success) refresh();
  return result;
}

/** Détail d'une écriture RH (fenêtre dynamique). */
export async function hrEntryDetailAction(input: { id: string }): Promise<ActionResult<HrDetailDTO>> {
  return runAction(hrDetailSchema, input, getHrEntryDetail);
}

/** Affectation d'une écriture RH à une ligne du relevé. */
export async function assignHrEntryAction(input: HrAssignInput): Promise<ActionResult<{ id: string }>> {
  const result = await runAction(hrAssignSchema, input, assignHrEntryToLine);
  if (result.success) {
    refresh();
    revalidatePath("/releve");
  }
  return result;
}

/** Détache une écriture RH du relevé. */
export async function unlinkHrEntryAction(input: { id: string }): Promise<ActionResult<{ lines: number }>> {
  const result = await runAction(hrDetailSchema, input, unlinkHrEntryFromLines);
  if (result.success) {
    refresh();
    revalidatePath("/releve");
  }
  return result;
}
