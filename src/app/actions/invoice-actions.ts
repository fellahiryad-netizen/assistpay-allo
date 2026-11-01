"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runAction, runUploadAction } from "@/app/actions/action-helpers";
import {
  invoiceIdSchema,
  invoiceInputSchema,
  markPaidSchema,
  setStatusSchema,
  type MarkPaidInput,
  type SetStatusInput,
} from "@/features/invoices/schemas";
import {
  createInvoice,
  markInvoicePaid,
  setInvoiceStatus,
  updateInvoice,
} from "@/features/invoices/services/invoice-service";
import { applyInvoiceImport, previewInvoiceImport, type InvoiceImportPlan } from "@/features/invoices/services/invoice-import";
import type { InvoiceDTO } from "@/features/invoices/types";
import type { ActionResult } from "@/types";

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
