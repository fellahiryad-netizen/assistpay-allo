"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runAction, runUploadAction } from "@/app/actions/action-helpers";
import {
  invoiceIdSchema,
  invoiceInputSchema,
  markPaidSchema,
  bulkDeleteSchema,
  bulkPaidSchema,
  type BulkDeleteInput,
  type BulkPaidInput,
  setStatusSchema,
  type MarkPaidInput,
  type SetStatusInput,
} from "@/features/invoices/schemas";
import {
  createInvoice,
  deleteInvoice,
  markInvoicePaid,
  setInvoiceStatus,
  updateInvoice,
} from "@/features/invoices/services/invoice-service";
import { requestDeletion } from "@/features/invoices/services/deletion-service";
import { ensureCaatAdvances } from "@/features/invoices/services/caat-advances";
import { applyInvoiceImport, previewInvoiceImport, type InvoiceImportPlan } from "@/features/invoices/services/invoice-import";
import type { InvoiceDTO } from "@/features/invoices/types";
import { ok, type ActionResult } from "@/types";

function refresh(id?: string): void {
  revalidatePath("/factures");
  revalidatePath("/");
  if (id) revalidatePath(`/factures/${id}`);
}

/** Ajout d'une facture client ou fournisseur. */
export async function createInvoiceAction(input: unknown): Promise<ActionResult<InvoiceDTO>> {
  const result = await runAction(invoiceInputSchema, input, createInvoice);
  if (result.success) refresh(result.data.id);
  return result;
}

const updateSchema = z.object({ id: invoiceIdSchema, values: invoiceInputSchema });

/** Modification d'une facture. */
export async function updateInvoiceAction(id: string, values: unknown): Promise<ActionResult<InvoiceDTO>> {
  const result = await runAction(updateSchema, { id, values }, (actor, input) => updateInvoice(actor, input.id, input.values));
  if (result.success) refresh(id);
  return result;
}

/** Suppression d'une facture (non réglée). */
export async function deleteInvoiceAction(id: string): Promise<ActionResult<{ id: string }>> {
  const result = await runAction(invoiceIdSchema, id, (actor, value) => deleteInvoice(actor, value));
  if (result.success) refresh();
  return result;
}

/** Enregistrement d'un règlement. */
export async function markInvoicePaidAction(input: MarkPaidInput): Promise<ActionResult<InvoiceDTO>> {
  const result = await runAction(markPaidSchema, input, markInvoicePaid);
  if (result.success) refresh(input.id);
  return result;
}

/** Remise en attente ou annulation. */
export async function setInvoiceStatusAction(input: SetStatusInput): Promise<ActionResult<InvoiceDTO>> {
  const result = await runAction(setStatusSchema, input, setInvoiceStatus);
  if (result.success) refresh(input.id);
  return result;
}

/** Aperçu de l'import du fichier de facturation (classeur de suivi ou classeur partenaires). */
export async function previewInvoiceImportAction(formData: FormData): Promise<ActionResult<InvoiceImportPlan>> {
  return runUploadAction(formData, previewInvoiceImport);
}

const selectionSchema = z.array(z.string().max(120)).max(2000).nullable();

/** Application de l'import ; `selection` (JSON) liste les feuilles cochées d'un classeur partenaires. */
export async function applyInvoiceImportAction(formData: FormData): Promise<ActionResult<{ created: number; updated: number }>> {
  const raw = formData.get("selection");
  let selection: string[] | null = null;
  if (typeof raw === "string" && raw !== "") {
    try {
      const parsed = selectionSchema.safeParse(JSON.parse(raw));
      if (parsed.success) selection = parsed.data;
    } catch {
      selection = null;
    }
  }
  const result = await runUploadAction(formData, (actor, file) => applyInvoiceImport(actor, file, selection));
  if (result.success) refresh();
  return result;
}

const advancesSchema = z.object({ period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Mois invalide.") });

/** Création des neuf avances CAAT d'un mois (« AAAA-MM »), sans doublon. */
export async function createCaatAdvancesAction(input: unknown): Promise<ActionResult<{ created: number; existing: number }>> {
  const result = await runAction(advancesSchema, input, (actor, values) => ensureCaatAdvances(actor, values.period));
  if (result.success) refresh();
  return result;
}

/** Bilan d'une action de masse : nombre de réussites et motifs d'échec par facture. */
export interface BulkReport {
  done: number;
  /** Suppressions envoyées pour validation (utilisateur non administrateur). */
  pending: number;
  failures: string[];
}

/** Règle plusieurs factures en une fois (même date, mode, référence et banque). */
export async function markInvoicesPaidBulkAction(input: BulkPaidInput): Promise<ActionResult<BulkReport>> {
  const result = await runAction(bulkPaidSchema, input, async (actor, value): Promise<ActionResult<BulkReport>> => {
    const report: BulkReport = { done: 0, pending: 0, failures: [] };
    for (const id of value.ids) {
      const one = await markInvoicePaid(actor, { id, date: value.date, mode: value.mode, reference: value.reference, banque: value.banque });
      if (one.success) report.done += 1;
      else report.failures.push(`${one.error}`);
    }
    return ok(report);
  });
  if (result.success) refresh();
  return result;
}

/** Supprime plusieurs factures (demande de validation pour les non-administrateurs). */
export async function deleteInvoicesBulkAction(input: BulkDeleteInput): Promise<ActionResult<BulkReport>> {
  const result = await runAction(bulkDeleteSchema, input, async (actor, value): Promise<ActionResult<BulkReport>> => {
    const report: BulkReport = { done: 0, pending: 0, failures: [] };
    for (const id of value.ids) {
      const one = await requestDeletion(actor, { kind: "facture", id, motif: value.motif });
      if (!one.success) report.failures.push(one.error);
      else if (one.data.done) report.done += 1;
      else report.pending += 1;
    }
    return ok(report);
  });
  if (result.success) refresh();
  return result;
}
