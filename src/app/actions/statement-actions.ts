"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { firstIssue, runAction, runUploadAction } from "@/app/actions/action-helpers";
import {
  applyProposalsSchema,
  assignLineSchema,
  columnMappingSchema,
  createFromLineSchema,
  doubleEntrySchema,
  lineIdSchema,
  linkExistingSchema,
  notDoubleSchema,
  transferLinkSchema,
  type ApplyProposalsInput,
  type AssignLineInput,
  type CreateFromLineInput,
  type DoubleEntryInput,
  type LinkExistingInput,
  type NotDoubleInput,
  type TransferLinkInput,
} from "@/features/statement/schemas";
import {
  applyDoubleEntry,
  applyTransferReconciliation,
  linkExistingDebit,
  markNotDouble,
  refuseTransfer,
} from "@/features/statement/services/double-entry-service";
import {
  analyseStatement,
  applyProposals,
  assignCandidates,
  assignLine,
  createInvoiceFromLine,
  ignoreLine,
  previewStatement,
  recheckTodo,
  reopenLine,
} from "@/features/statement/services/statement-service";
import type { AssignCandidate, StatementAnalysis, StatementPreview } from "@/features/statement/types";
import { fail, type ActionResult } from "@/types";

function refresh(): void {
  revalidatePath("/releve", "layout");
  revalidatePath("/factures");
  revalidatePath("/");
}

/** Lecture du fichier de la banque : colonnes proposées et aperçu. */
export async function previewStatementAction(formData: FormData): Promise<ActionResult<StatementPreview>> {
  return runUploadAction(formData, previewStatement);
}

/** Analyse du relevé avec la correspondance de colonnes choisie. */
export async function analyseStatementAction(formData: FormData): Promise<ActionResult<StatementAnalysis>> {
  const result = await runUploadAction(formData, async (actor, file) => {
    let raw: unknown;
    try {
      raw = JSON.parse(String(formData.get("mapping") ?? "{}"));
    } catch {
      return fail<StatementAnalysis>("Correspondance des colonnes invalide.", "VALIDATION");
    }
    const mapping = columnMappingSchema.safeParse(raw);
    if (!mapping.success) return fail<StatementAnalysis>(firstIssue(mapping.error), "VALIDATION");
    return analyseStatement(actor, file, mapping.data);
  });
  if (result.success) refresh();
  return result;
}

/** Validation des rapprochements cochés. */
export async function applyProposalsAction(input: ApplyProposalsInput): Promise<ActionResult<{ invoices: number; lines: number }>> {
  const result = await runAction(applyProposalsSchema, input, applyProposals);
  if (result.success) refresh();
  return result;
}

/** Nouvelle analyse des lignes « à traiter ». */
export async function recheckTodoAction(): Promise<ActionResult<StatementAnalysis>> {
  const result = await runAction(z.object({}), {}, (actor) => recheckTodo(actor));
  if (result.success) refresh();
  return result;
}

/** Ligne ignorée. */
export async function ignoreLineAction(lineId: string): Promise<ActionResult<true>> {
  const result = await runAction(lineIdSchema, lineId, ignoreLine);
  if (result.success) refresh();
  return result;
}

/** Ligne remise à traiter. */
export async function reopenLineAction(lineId: string): Promise<ActionResult<true>> {
  const result = await runAction(lineIdSchema, lineId, reopenLine);
  if (result.success) refresh();
  return result;
}

/** Factures proposées pour une affectation manuelle. */
export async function assignCandidatesAction(lineId: string): Promise<ActionResult<AssignCandidate[]>> {
  return runAction(lineIdSchema, lineId, assignCandidates);
}

/** Affectation manuelle d'une ligne. */
export async function assignLineAction(input: AssignLineInput): Promise<ActionResult<{ invoices: number }>> {
  const result = await runAction(assignLineSchema, input, assignLine);
  if (result.success) refresh();
  return result;
}

/** Paiement ajouté au suivi depuis le relevé. */
export async function createInvoiceFromLineAction(input: CreateFromLineInput): Promise<ActionResult<{ invoiceId: string }>> {
  const result = await runAction(createFromLineSchema, input, createInvoiceFromLine);
  if (result.success) refresh();
  return result;
}

/** Rapprochement d'un débit global avec le détail de l'envoi de virements. */
export async function applyTransferAction(input: TransferLinkInput): Promise<ActionResult<{ found: number; created: number }>> {
  const result = await runAction(transferLinkSchema, input, applyTransferReconciliation);
  if (result.success) refresh();
  return result;
}

/** « C'est un autre virement ». */
export async function refuseTransferAction(input: TransferLinkInput): Promise<ActionResult<true>> {
  const result = await runAction(transferLinkSchema, input, refuseTransfer);
  if (result.success) refresh();
  return result;
}

/** Rapprochement avec une ligne déjà saisie au Débit. */
export async function linkExistingAction(input: LinkExistingInput): Promise<ActionResult<true>> {
  const result = await runAction(linkExistingSchema, input, linkExistingDebit);
  if (result.success) refresh();
  return result;
}

/** Validation d'un double emploi. */
export async function applyDoubleEntryAction(input: DoubleEntryInput): Promise<ActionResult<{ remaining: number }>> {
  const result = await runAction(doubleEntrySchema, input, applyDoubleEntry);
  if (result.success) refresh();
  return result;
}

/** « Ce n'est pas un doublon ». */
export async function markNotDoubleAction(input: NotDoubleInput): Promise<ActionResult<true>> {
  const result = await runAction(notDoubleSchema, input, markNotDouble);
  if (result.success) refresh();
  return result;
}
