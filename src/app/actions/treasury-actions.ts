"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runAction, runUploadAction } from "@/app/actions/action-helpers";
import type { AuthUser } from "@/features/access/types";
import {
  lineDecisionSchema,
  lineIdSchema,
  manualBalanceSchema,
  scenarioActivateSchema,
  scenarioCreateSchema,
  scenarioDuplicateSchema,
  scenarioIdSchema,
  simLineSchema,
  simLineUpdateSchema,
  treasurySettingsSchema,
  type LineDecisionInput,
  type LineIdInput,
  type ManualBalanceInput,
  type ScenarioActivateInput,
  type ScenarioCreateInput,
  type ScenarioDuplicateInput,
  type ScenarioIdInput,
  type SimLineInput,
  type SimLineUpdateInput,
  type TreasurySettingsInput,
} from "@/features/treasury/schemas";
import {
  activateScenarioEntry,
  addSimulationLine,
  clearScenarioEntry,
  createScenarioEntry,
  decideSimulationLine,
  deleteScenarioEntry,
  duplicateScenarioEntry,
  removeSimulationLine,
  updateSimulationLine,
} from "@/features/treasury/services/treasury-scenarios";
import { importStatementFromTreasury, type TreasuryImportResult } from "@/features/treasury/services/treasury-statement-upload";
import { clearManualBalance, saveManualBalance, saveTreasurySettings } from "@/features/treasury/services/treasury-service";
import type { ActionResult } from "@/types";

function refresh(): void {
  revalidatePath("/tresorerie");
}

async function run<S extends z.ZodTypeAny, T>(schema: S, input: unknown, handler: (actor: AuthUser, value: z.output<S>) => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  const result = await runAction(schema, input, handler);
  if (result.success) refresh();
  return result;
}

/** Crée un scénario de simulation vide. */
export async function createScenarioAction(input: ScenarioCreateInput): Promise<ActionResult<{ id: string }>> {
  return run(scenarioCreateSchema, input, createScenarioEntry);
}

/** Duplique un scénario avec ses lignes. */
export async function duplicateScenarioAction(input: ScenarioDuplicateInput): Promise<ActionResult<{ id: string }>> {
  return run(scenarioDuplicateSchema, input, duplicateScenarioEntry);
}

/** Active un scénario (mode simulation) ou revient à la situation réelle. */
export async function activateScenarioAction(input: ScenarioActivateInput): Promise<ActionResult<true>> {
  return run(scenarioActivateSchema, input, activateScenarioEntry);
}

/** Supprime un scénario. */
export async function deleteScenarioAction(input: ScenarioIdInput): Promise<ActionResult<true>> {
  return run(scenarioIdSchema, input, deleteScenarioEntry);
}

/** Réinitialise un scénario (retire toutes ses lignes). */
export async function clearScenarioAction(input: ScenarioIdInput): Promise<ActionResult<true>> {
  return run(scenarioIdSchema, input, clearScenarioEntry);
}

/** Ajoute une ligne de simulation ; renvoie les doublons éventuels. */
export async function addSimulationLineAction(input: SimLineInput): Promise<ActionResult<{ lineId: string; warnings: string[] }>> {
  return run(simLineSchema, input, addSimulationLine);
}

/** Modifie une ligne de simulation. */
export async function updateSimulationLineAction(input: SimLineUpdateInput): Promise<ActionResult<{ warnings: string[] }>> {
  return run(simLineUpdateSchema, input, updateSimulationLine);
}

/** Supprime une ligne de simulation. */
export async function removeSimulationLineAction(input: LineIdInput): Promise<ActionResult<true>> {
  return run(lineIdSchema, input, removeSimulationLine);
}

/** Décision sur un doublon : ne pas compter, garder quand même, ou annuler la décision. */
export async function decideSimulationLineAction(input: LineDecisionInput): Promise<ActionResult<true>> {
  return run(lineDecisionSchema, input, decideSimulationLine);
}

/** Réglages de la trésorerie (minimum de trésorerie, encaissements attendus). */
export async function saveTreasurySettingsAction(input: TreasurySettingsInput): Promise<ActionResult<true>> {
  return run(treasurySettingsSchema, input, saveTreasurySettings);
}

/** Solde saisi à la main (secours). */
export async function saveManualBalanceAction(input: ManualBalanceInput): Promise<ActionResult<true>> {
  return run(manualBalanceSchema, input, saveManualBalance);
}

/** Retire le solde saisi à la main. */
export async function clearManualBalanceAction(): Promise<ActionResult<true>> {
  return run(z.object({}), {}, (actor) => clearManualBalance(actor));
}

/**
 * Importe un relevé AGB (.xls, .xlsx, .csv) depuis l'onglet Trésorerie, par le flux d'import du relevé bancaire.
 * Les lignes rapprochées touchent aussi les pages Relevé et Factures : elles sont rafraîchies avec la trésorerie.
 */
export async function importStatementFromTreasuryAction(formData: FormData): Promise<ActionResult<TreasuryImportResult>> {
  const result = await runUploadAction(formData, importStatementFromTreasury);
  revalidatePath("/tresorerie");
  if (result.success) {
    revalidatePath("/releve", "layout");
    revalidatePath("/factures");
    revalidatePath("/");
  }
  return result;
}
