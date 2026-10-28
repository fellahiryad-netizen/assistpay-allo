"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runAction } from "@/app/actions/action-helpers";
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
