import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { can, requireAdmin } from "@/features/access/services/access-rules";
import type { AuthUser } from "@/features/access/types";
import { deleteIssued } from "@/features/billing/services/billing-service";
import { deleteInvoice } from "@/features/invoices/services/invoice-service";
import { logAction } from "@/features/journal/services/journal-service";
import { fail, ok, type ActionResult } from "@/types";
import { formatDA } from "@/utils/format";

const KEY = "suppressions";

/** Type de facture concerné par une demande. */
export type DeletionKind = "facture" | "etablie";

/** Demande de suppression en attente de validation, ou déjà traitée. */
export interface DeletionRequest {
  id: string;
  kind: DeletionKind;
  targetId: string;
  label: string;
  amount: number;
  motif: string;
  by: string;
  byId: string;
  at: string;
  status: "attente" | "validee" | "refusee";
  decidedBy?: string;
  decidedAt?: string;
  note?: string;
  error?: string;
}

function read(value: Prisma.JsonValue | undefined): DeletionRequest[] {
  const items = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>).items : null;
  return Array.isArray(items) ? (items as DeletionRequest[]) : [];
}

async function load(): Promise<DeletionRequest[]> {
  const row = await db.setting.findUnique({ where: { key: KEY } });
  return read(row?.value);
}

async function save(items: DeletionRequest[]): Promise<void> {
  const value = JSON.parse(JSON.stringify({ items: items.slice(0, 300) })) as Prisma.InputJsonValue;
  await db.setting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } });
}

async function describeTarget(kind: DeletionKind, id: string): Promise<{ label: string; amount: number } | null> {
  if (kind === "facture") {
    const row = await db.invoice.findUnique({ where: { id } });
    return row ? { label: `${row.sens === "CREDIT" ? "Client" : "Fournisseur"} – ${row.tiers}${row.numero ? ` – ${row.numero}` : ""}`, amount: Number(row.montant) } : null;
  }
  const doc = await db.issuedInvoice.findUnique({ where: { id } });
  return doc ? { label: `Facture établie ${doc.num} – ${doc.client}`, amount: Number(doc.ttc) } : null;
}

async function execute(actor: AuthUser, kind: DeletionKind, id: string, motif: string): Promise<ActionResult<true>> {
  const result = kind === "facture" ? await deleteInvoice(actor, id) : await deleteIssued(actor, { id, motif });
  return result.success ? ok(true) : result;
}

/**
 * Demande la suppression d'une facture. Un administrateur supprime directement (son clic vaut validation) ;
 * les autres utilisateurs autorisés créent une demande que l'administrateur doit valider.
 */
export async function requestDeletion(actor: AuthUser, input: { kind: DeletionKind; id: string; motif: string }): Promise<ActionResult<{ done: boolean }>> {
  if (!can(actor, "A_SUPPR", "EDIT")) return fail("Le droit « Demander la suppression d'une facture » ne vous est pas accordé.", "FORBIDDEN");
  const target = await describeTarget(input.kind, input.id);
  if (!target) return fail("Facture introuvable.", "NOT_FOUND");
  if (actor.isAdmin) {
    const done = await execute(actor, input.kind, input.id, input.motif);
    return done.success ? ok({ done: true }) : done;
  }
  const items = await load();
  if (items.some((item) => item.status === "attente" && item.targetId === input.id)) return fail("Une demande de suppression est déjà en attente pour cette facture.", "CONFLICT");
  items.unshift({ id: `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, kind: input.kind, targetId: input.id, label: target.label, amount: target.amount, motif: input.motif, by: actor.name, byId: actor.id, at: new Date().toISOString(), status: "attente" });
  await save(items);
  await logAction(actor, "Demande de suppression de facture", `${target.label} – ${formatDA(target.amount)}${input.motif ? ` – motif : ${input.motif}` : ""}`);
  return ok({ done: false });
}

/** Demandes de suppression (administrateur). */
export async function listDeletions(actor: AuthUser): Promise<ActionResult<DeletionRequest[]>> {
  const guard = requireAdmin(actor);
  if (!guard.success) return guard;
  return ok(await load());
}

/** Nombre de demandes en attente (pastille du menu, administrateurs seulement). */
export async function countPendingDeletions(actor: AuthUser): Promise<number> {
  if (!actor.isAdmin) return 0;
  try {
    return (await load()).filter((item) => item.status === "attente").length;
  } catch {
    return 0;
  }
}

/** L'administrateur valide (la facture est supprimée) ou refuse une demande de suppression. */
export async function decideDeletion(actor: AuthUser, input: { id: string; approve: boolean; note: string }): Promise<ActionResult<{ approved: boolean }>> {
  const guard = requireAdmin(actor);
  if (!guard.success) return guard;
  const items = await load();
  const request = items.find((item) => item.id === input.id);
  if (!request) return fail("Demande introuvable.", "NOT_FOUND");
  if (request.status !== "attente") return fail("Cette demande a déjà été traitée.", "CONFLICT");
  if (input.approve) {
    const done = await execute(actor, request.kind, request.targetId, request.motif);
    if (!done.success) return done;
  }
  request.status = input.approve ? "validee" : "refusee";
  request.decidedBy = actor.name;
  request.decidedAt = new Date().toISOString();
  request.note = input.note;
  await save(items);
  await logAction(actor, input.approve ? "Suppression validée" : "Suppression refusée", `${request.label} – demandée par ${request.by}${input.note ? ` – ${input.note}` : ""}`, true);
  return ok({ approved: input.approve });
}
