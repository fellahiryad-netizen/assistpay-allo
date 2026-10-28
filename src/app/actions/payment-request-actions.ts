"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runAction, runUploadAction } from "@/app/actions/action-helpers";
import { dpCreateSchema, dpIdSchema, dpLinkSchema, dpUpdateSchema, type DpCreateInput, type DpLinkInput, type DpUpdateInput } from "@/features/payment-requests/schemas";
import {
  applyRequestImport,
  createFromInvoices,
  deleteRequest,
  invoiceOptions,
  linkInvoices,
  previewRequestImport,
  updateRequest,
} from "@/features/payment-requests/services/payment-request-service";
import type { DpImportPlan, DpInvoiceOption, PaymentRequestDTO } from "@/features/payment-requests/types";
import type { ActionResult } from "@/types";

function refresh(id?: string): void {
  revalidatePath("/demandes");
  if (id) revalidatePath(`/demandes/${id}`);
  revalidatePath("/factures");
}

/** Enregistrement / validation d'une demande. */
export async function updateRequestAction(input: DpUpdateInput): Promise<ActionResult<PaymentRequestDTO>> {
  const result = await runAction(dpUpdateSchema, input, updateRequest);
  if (result.success) refresh(input.id);
  return result;
}

/** Création d'une demande depuis des factures fournisseurs. */
export async function createRequestAction(input: DpCreateInput): Promise<ActionResult<{ id: string; ref: string }>> {
  const result = await runAction(dpCreateSchema, input, createFromInvoices);
  if (result.success) refresh(result.data.id);
  return result;
}

/** Liaison d'une demande à des factures. */
export async function linkRequestAction(input: DpLinkInput): Promise<ActionResult<true>> {
  const result = await runAction(dpLinkSchema, input, linkInvoices);
  if (result.success) refresh(input.id);
  return result;
}

/** Suppression d'une demande (administrateurs). */
export async function deleteRequestAction(id: string): Promise<ActionResult<true>> {
  const result = await runAction(dpIdSchema, id, deleteRequest);
  if (result.success) refresh();
  return result;
}

/** Recherche de factures fournisseurs en attente. */
export async function requestInvoiceOptionsAction(search: string): Promise<ActionResult<DpInvoiceOption[]>> {
  return runAction(z.string().trim().max(120), search, invoiceOptions);
}

/** Aperçu de l'import d'un classeur de demandes. */
export async function previewRequestImportAction(formData: FormData): Promise<ActionResult<DpImportPlan>> {
  return runUploadAction(formData, previewRequestImport);
}

/** Application de l'import d'un classeur de demandes. */
export async function applyRequestImportAction(formData: FormData): Promise<ActionResult<{ created: string[]; updated: number }>> {
  const result = await runUploadAction(formData, applyRequestImport);
  if (result.success) refresh();
  return result;
}
