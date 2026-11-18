import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { requireAccess } from "@/features/access/services/access-rules";
import type { AuthUser } from "@/features/access/types";
import { readExtra } from "@/features/invoices/services/invoice-extra";
import { analyseNumbering, buildPairingIndex, extractMotif, pairedInvoice } from "@/features/numbering/lib/numbering-analysis";
import type { DeletionTrace, NumberSource, NumberingAnalysis } from "@/features/numbering/types";
import { fail, ok, type ActionResult } from "@/types";

/* Registre de numérotation : lecture seule. Aucune écriture en base, aucun numéro généré ici. */

const DELETION_ACTIONS = ["Suppression facture", "Suppression facture établie"];

function obj(value: Prisma.JsonValue | undefined): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

const str = (value: unknown): string => (typeof value === "string" ? value : value === null || value === undefined ? "" : String(value));

async function loadSources(): Promise<NumberSource[]> {
  const [invoices, issued] = await Promise.all([
    db.invoice.findMany({ where: { sens: "CREDIT", numero: { not: "" } }, select: { legacyId: true, numero: true, tiers: true, extra: true } }),
    db.issuedInvoice.findMany({ select: { id: true, num: true, client: true, invoiceLegacyId: true, payload: true } }),
  ]);
  const sources: NumberSource[] = [];
  const index = buildPairingIndex(
    invoices.map((invoice) => {
      const extra = readExtra(invoice.extra);
      return { legacyId: invoice.legacyId, tiers: invoice.tiers, numbers: [invoice.numero, extra.factureDebours ?? "", extra.factureFrais ?? ""] };
    }),
  );
  for (const invoice of invoices) {
    const docKey = `inv:${invoice.legacyId}`;
    const label = `${invoice.tiers || "Facture"} (suivi)`;
    sources.push({ raw: invoice.numero, docKey, origin: "suivi", label });
    const extra = readExtra(invoice.extra);
    if (extra.factureDebours) sources.push({ raw: extra.factureDebours, docKey, origin: "suivi", label });
    if (extra.factureFrais) sources.push({ raw: extra.factureFrais, docKey, origin: "suivi", label });
  }
  for (const doc of issued) {
    const payload = obj(doc.payload);
    const isAvoir = str(payload.kind) === "avoir";
    // La facture établie et sa ligne du suivi sont le même document : même clé, pas de faux doublon.
    // Sans lien explicite, on rapproche par numéro identique + même client, seulement si une seule facture du suivi correspond.
    const paired = !isAvoir && !doc.invoiceLegacyId ? pairedInvoice(index, doc.num, doc.client) : null;
    const docKey = !isAvoir && doc.invoiceLegacyId ? `inv:${doc.invoiceLegacyId}` : paired ? `inv:${paired}` : `iss:${doc.id}`;
    const origin = isAvoir ? "avoir" : "etablie";
    const label = `${doc.client || "Facture"} (${isAvoir ? "avoir" : "facture établie"})`;
    sources.push({ raw: doc.num, docKey, origin, label });
    const second = str(payload.num2);
    if (second) sources.push({ raw: second, docKey, origin, label });
  }
  return sources;
}

async function loadDeletions(isAdmin: boolean): Promise<DeletionTrace[]> {
  const [journal, setting] = await Promise.all([
    db.journalEntry.findMany({ where: { admin: false, action: { in: DELETION_ACTIONS } }, orderBy: { at: "desc" }, take: 5000, select: { at: true, userName: true, objet: true } }),
    db.setting.findUnique({ where: { key: "suppressions" } }),
  ]);
  // Le journal est réservé aux administrateurs : les autres utilisateurs voient qu'un numéro a été supprimé, sans l'auteur ni le motif.
  const traces: DeletionTrace[] = journal.map((row) => ({ text: row.objet, at: row.at.toISOString(), by: isAdmin ? row.userName : undefined, motif: isAdmin ? extractMotif(row.objet) : undefined, origin: "journal" }));
  const items = obj(setting?.value).items;
  if (Array.isArray(items)) {
    for (const item of items) {
      const request = obj(item as Prisma.JsonValue);
      if (str(request.status) !== "validee") continue;
      traces.push({ text: str(request.label), at: str(request.decidedAt) || str(request.at) || undefined, by: str(request.decidedBy) || str(request.by) || undefined, motif: str(request.motif) || undefined, origin: "demande" });
    }
  }
  // Rectification : l'ancien numéro reste seulement dans l'historique de versions de la facture établie.
  const issued = await db.issuedInvoice.findMany({ select: { num: true, payload: true } });
  for (const doc of issued) {
    const payload = obj(doc.payload);
    const versions = Array.isArray(payload.versions) ? payload.versions : [];
    const current = [doc.num, str(payload.num2)].filter(Boolean).join(" ");
    for (const version of versions) {
      const old = obj(version as Prisma.JsonValue);
      const oldNumbers = [str(old.num), str(old.num2)].filter((value) => value && !current.includes(value));
      for (const text of oldNumbers) traces.push({ text, by: str(obj(payload.maj as Prisma.JsonValue).nom) || undefined, motif: str(old.motif) || undefined, origin: "rectification" });
    }
  }
  return traces;
}

/**
 * Registre de numérotation : séries (famille + année), dernier numéro, trous, doublons et numéros de factures supprimées.
 * Lecture seule, à partir des factures du suivi, des factures établies, des avoirs, du journal et de l'historique des suppressions.
 */
export async function getNumberingRegistry(actor: AuthUser): Promise<ActionResult<NumberingAnalysis>> {
  const guard = requireAccess(actor, "FACT");
  if (!guard.success) return guard;
  try {
    const [sources, deletions] = await Promise.all([loadSources(), loadDeletions(actor.isAdmin)]);
    return ok(analyseNumbering(sources, deletions));
  } catch (error) {
    console.error("[numerotation] lecture impossible :", error);
    return fail("Le registre de numérotation n'a pas pu être lu.", "DATABASE");
  }
}
