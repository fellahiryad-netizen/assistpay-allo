import { db } from "@/lib/db";
import { readWorkbook } from "@/lib/spreadsheet";
import type { Prisma, PaymentRequest } from "@/generated/prisma/client";
import { can, requireAccess, requireAdmin } from "@/features/access/services/access-rules";
import type { AuthUser } from "@/features/access/types";
import { remaining, toPayable } from "@/features/invoices/services/invoice-balance";
import { decimalToNumber } from "@/features/invoices/services/invoice-mapper";
import { logAction } from "@/features/journal/services/journal-service";
import type { DpCreateInput, DpLinkInput, DpQuery, DpUpdateInput } from "@/features/payment-requests/schemas";
import { beneficiaryKey, parseRequestWorkbook, productFromCategory } from "@/features/payment-requests/services/dp-import-parser";
import type { DpImportPlan, DpInvoiceOption, DpPaymentState, DpProduct, ImportedRequest, PaymentRequestDTO } from "@/features/payment-requests/types";
import { fail, ok, type ActionResult, type Paginated } from "@/types";
import { round2 } from "@/utils/amounts";
import { fromIsoDate, toIsoDate, todayIso } from "@/utils/dates";
import { formatDA, formatDate } from "@/utils/format";
import { sameBeneficiary, upperPlain } from "@/utils/text";

const PAGE_SIZE = 50;

/** Fichier envoyé par le navigateur. */
export interface DpFile {
  name: string;
  bytes: Uint8Array;
}

/** Référence d'une demande : « 0815/2026AS ». */
export function requestRef(num: number, year: number): string {
  return `${String(num).padStart(4, "0")}/${year}AS`;
}

const invoiceNumberKey = (value: string): string => upperPlain(value).replace(/[^A-Z0-9]/g, "").replace(/^(FACTURE|FACT|FAC|N)+/, "");

function extraObject(extra: Prisma.JsonValue): Record<string, unknown> {
  return extra && typeof extra === "object" && !Array.isArray(extra) ? (extra as Record<string, unknown>) : {};
}

function storedFactures(extra: Prisma.JsonValue): Array<{ n: string; d: string }> {
  const value = extraObject(extra).factures;
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => (item && typeof item === "object" && "n" in item ? [{ n: String((item as { n: unknown }).n ?? ""), d: String((item as { d?: unknown }).d ?? "") }] : []));
}

function transferSent(extra: Prisma.JsonValue): string | null {
  const value = extraObject(extra).virEnvoi;
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "fichier" in value) return String((value as { fichier: unknown }).fichier);
  return value ? "oui" : null;
}

/** Produit d'une facture fournisseur (règle de l'ancienne version). */
function productOfInvoice(categorie: string, nature: string): DpProduct {
  const text = upperPlain(`${categorie} ${nature}`);
  if (/BDG/.test(text)) return "BDG";
  if (/TPA|TIERS PAYANT/.test(text)) return "Tiers payant";
  if (/ASSIST/.test(text)) return "Assistance routière";
  return "Autre";
}

type InvoiceLite = { id: string; legacyId: string; numero: string; tiers: string; montant: Prisma.Decimal; status: string; dateOperation: Date | null; sens: string };

/** Factures reliées : par identifiant si la demande en a, sinon par n° de facture et bénéficiaire. */
function linkedInvoices(request: PaymentRequest, byLegacy: Map<string, InvoiceLite>, debitByNumber: Map<string, InvoiceLite[]>): InvoiceLite[] {
  if (request.invoiceIds.length) return request.invoiceIds.flatMap((id) => (byLegacy.get(id) ? [byLegacy.get(id) as InvoiceLite] : []));
  const out: InvoiceLite[] = [];
  for (const facture of storedFactures(request.extra)) {
    const key = invoiceNumberKey(facture.n);
    if (key.length < 3) continue;
    const candidates = (debitByNumber.get(key) ?? []).filter(
      (invoice) => sameBeneficiary(invoice.tiers, request.beneficiaire) || Math.abs(decimalToNumber(invoice.montant) - decimalToNumber(request.montant)) < 1,
    );
    const best = candidates.find((invoice) => Math.abs(decimalToNumber(invoice.montant) - decimalToNumber(request.montant)) < 1) ?? candidates[0];
    if (best) out.push(best);
  }
  return out;
}

function paymentState(invoices: InvoiceLite[]): PaymentRequestDTO["payment"] {
  const list = invoices.map((invoice) => ({ id: invoice.id, label: invoice.numero || "sans n°", status: invoice.status }));
  if (invoices.length === 0) return { state: "non_reliee", label: "Non reliée", invoices: list };
  const paid = invoices.filter((invoice) => invoice.status === "REGLE");
  let state: DpPaymentState = "non_payee";
  let label = "Non payée";
  if (paid.length === invoices.length) {
    state = "payee";
    const date = toIsoDate(paid[0]?.dateOperation ?? null);
    label = `Payée${date ? ` le ${formatDate(date)}` : ""}`;
  } else if (paid.length) {
    state = "partielle";
    label = "Partiellement payée";
  }
  return { state, label, invoices: list };
}

async function invoiceMaps(requests: PaymentRequest[]): Promise<{ byLegacy: Map<string, InvoiceLite>; debitByNumber: Map<string, InvoiceLite[]> }> {
  const ids = [...new Set(requests.flatMap((request) => request.invoiceIds))];
  const select = { id: true, legacyId: true, numero: true, tiers: true, montant: true, status: true, dateOperation: true, sens: true } as const;
  const byIds = ids.length ? await db.invoice.findMany({ where: { legacyId: { in: ids } }, select }) : [];
  const numbers = requests.filter((request) => !request.invoiceIds.length).flatMap((request) => storedFactures(request.extra).map((facture) => facture.n));
  const byNumbers = numbers.length
    ? await db.invoice.findMany({ where: { sens: "DEBIT", numero: { not: "" }, OR: numbers.slice(0, 200).map((n) => ({ numero: { contains: n.replace(/^(FACTURE|FACT|FAC)\s*N?°?\s*/i, "").slice(-6), mode: "insensitive" as const } })) }, select })
    : [];
  const debitByNumber = new Map<string, InvoiceLite[]>();
  for (const invoice of byNumbers) {
    const key = invoiceNumberKey(invoice.numero);
    debitByNumber.set(key, [...(debitByNumber.get(key) ?? []), invoice]);
  }
  return { byLegacy: new Map(byIds.map((invoice) => [invoice.legacyId, invoice])), debitByNumber };
}

function toDTO(request: PaymentRequest, invoices: InvoiceLite[]): PaymentRequestDTO {
  const created = extraObject(request.extra).cree;
  const createdBy = created && typeof created === "object" && "nom" in created ? String((created as { nom: unknown }).nom) : "";
  return {
    id: request.id,
    num: request.num,
    ref: request.ref,
    date: toIsoDate(request.date),
    beneficiaire: request.beneficiaire,
    adresse: request.adresse,
    montant: decimalToNumber(request.montant),
    nature: request.nature,
    mode: request.mode,
    produit: request.produit,
    status: request.status,
    source: request.source,
    pieces: request.pieces,
    archived: request.archived,
    invoiceIds: request.invoiceIds,
    payment: paymentState(invoices),
    transferSent: transferSent(request.extra),
    createdBy,
  };
}

/** Liste des demandes de paiement (filtres : à valider, non payées, toutes ; recherche). */
export async function listRequests(
  actor: AuthUser,
  query: DpQuery,
): Promise<ActionResult<Paginated<PaymentRequestDTO> & { nextRef: string; toValidate: number; canEdit: boolean; sumMontant: number }>> {
  const guard = requireAccess(actor, "DP");
  if (!guard.success) return guard;
  const where: Prisma.PaymentRequestWhereInput = {
    ...(query.filtre === "a_valider" ? { status: "a_valider" } : {}),
    ...(query.q
      ? {
          OR: [
            { ref: { contains: query.q, mode: "insensitive" } },
            { beneficiaire: { contains: query.q, mode: "insensitive" } },
            { pieces: { has: query.q } },
            ...(Number.isFinite(Number(query.q.replace(/\s/g, "").replace(",", "."))) ? [{ montant: Number(query.q.replace(/\s/g, "").replace(",", ".")) }] : []),
          ],
        }
      : {}),
  };
  try {
    const [all, toValidate, next] = await Promise.all([
      db.paymentRequest.findMany({ where, orderBy: [{ num: "desc" }, { legacyId: "desc" }] }),
      db.paymentRequest.count({ where: { status: "a_valider" } }),
      nextNumber(),
    ]);
    let list = all;
    let maps = await invoiceMaps(query.filtre === "non_payee" ? all : all.slice((query.page - 1) * PAGE_SIZE, query.page * PAGE_SIZE));
    if (query.filtre === "non_payee") {
      list = all.filter((request) => {
        const state = paymentState(linkedInvoices(request, maps.byLegacy, maps.debitByNumber)).state;
        return state === "non_payee" || state === "partielle";
      });
    }
    const page = list.slice((query.page - 1) * PAGE_SIZE, query.page * PAGE_SIZE);
    if (query.filtre !== "non_payee") maps = await invoiceMaps(page);
    return ok({
      items: page.map((request) => toDTO(request, linkedInvoices(request, maps.byLegacy, maps.debitByNumber))),
      total: list.length,
      page: query.page,
      pageSize: PAGE_SIZE,
      pageCount: Math.max(1, Math.ceil(list.length / PAGE_SIZE)),
      nextRef: requestRef(next, Number(todayIso().slice(0, 4))),
      toValidate,
      canEdit: can(actor, "DP", "EDIT"),
      sumMontant: round2(list.reduce((sum, request) => sum + decimalToNumber(request.montant), 0)),
    });
  } catch (error) {
    console.error("[dp] liste :", error);
    return fail("Les demandes de paiement n'ont pas pu être chargées.", "DATABASE");
  }
}

/** Détail d'une demande. */
export async function getRequest(actor: AuthUser, id: string): Promise<ActionResult<{ request: PaymentRequestDTO; canEdit: boolean; isAdmin: boolean }>> {
  const guard = requireAccess(actor, "DP");
  if (!guard.success) return guard;
  const request = await db.paymentRequest.findUnique({ where: { id } });
  if (!request) return fail("Demande introuvable.", "NOT_FOUND");
  const maps = await invoiceMaps([request]);
  return ok({ request: toDTO(request, linkedInvoices(request, maps.byLegacy, maps.debitByNumber)), canEdit: can(actor, "DP", "EDIT"), isAdmin: actor.isAdmin });
}

async function nextNumber(): Promise<number> {
  const max = await db.paymentRequest.aggregate({ _max: { num: true } });
  return (max._max.num ?? 0) + 1;
}

/** Enregistre les modifications d'une demande ; `validate` la passe « émise ». */
export async function updateRequest(actor: AuthUser, input: DpUpdateInput): Promise<ActionResult<PaymentRequestDTO>> {
  const guard = requireAccess(actor, "DP", "EDIT");
  if (!guard.success) return guard;
  try {
    const current = await db.paymentRequest.findUnique({ where: { id: input.id } });
    if (!current) return fail("Demande introuvable.", "NOT_FOUND");
    const updated = await db.paymentRequest.update({
      where: { id: input.id },
      data: {
        date: fromIsoDate(input.date),
        beneficiaire: input.beneficiaire,
        adresse: input.adresse,
        montant: input.montant,
        nature: input.nature,
        mode: input.mode,
        produit: input.produit,
        pieces: input.pieces.filter(Boolean),
        ...(input.validate ? { status: "emise", extra: { ...extraObject(current.extra), valideeLe: new Date().toISOString() } as Prisma.InputJsonObject } : {}),
      },
    });
    await logAction(actor, input.validate ? "Validation demande de paiement" : "Modification demande de paiement", `${updated.ref} – ${updated.beneficiaire} – ${formatDA(input.montant)}`);
    const maps = await invoiceMaps([updated]);
    return ok(toDTO(updated, linkedInvoices(updated, maps.byLegacy, maps.debitByNumber)));
  } catch (error) {
    console.error("[dp] modification :", error);
    return fail("La demande n'a pas pu être enregistrée.", "DATABASE");
  }
}

async function createWithNextNumber(data: Omit<Prisma.PaymentRequestCreateInput, "num" | "ref" | "legacyId">): Promise<PaymentRequest> {
  const year = Number(todayIso().slice(0, 4));
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const num = (await nextNumber()) + attempt;
    try {
      return await db.paymentRequest.create({ data: { ...data, num, ref: requestRef(num, year), legacyId: `dp-${String(num).padStart(4, "0")}` } });
    } catch (error) {
      if (!(error instanceof Error) || !/Unique constraint|P2002/.test(`${error.message} ${(error as { code?: string }).code ?? ""}`)) throw error;
    }
  }
  throw new Error("Numérotation des demandes impossible.");
}

/**
 * Crée une demande de paiement à partir de factures fournisseurs en attente (même logique que l'ancienne version) :
 * montant = reste à payer, bénéficiaire = tiers de la première facture, pièces jointes = factures.
 */
export async function createFromInvoices(actor: AuthUser, input: DpCreateInput): Promise<ActionResult<{ id: string; ref: string }>> {
  const guard = requireAccess(actor, "DP", "EDIT");
  if (!guard.success) return guard;
  try {
    const rows = await db.invoice.findMany({ where: { id: { in: input.invoiceIds } } });
    const invoices = rows.map(toPayable);
    if (invoices.length !== input.invoiceIds.length) return fail("Facture introuvable.", "NOT_FOUND");
    if (invoices.some((invoice) => invoice.sens !== "DEBIT")) return fail("Une demande de paiement ne concerne que des factures fournisseurs (débit).", "VALIDATION");
    if (invoices.some((invoice) => invoice.payroll)) return fail("Les salaires, CNAS et G50 ne passent pas par les demandes de paiement.", "VALIDATION");
    const first = invoices[0];
    if (!first) return fail("Choisissez au moins une facture.", "VALIDATION");
    const total = round2(invoices.reduce((sum, invoice) => sum + (remaining(invoice) || invoice.montant), 0));
    const created = await createWithNextNumber({
      date: fromIsoDate(todayIso()),
      beneficiaire: (first.tiers || first.categorie).toUpperCase(),
      montant: total,
      nature: "Règlement de facture prestataire",
      mode: rows[0]?.mode === "CHEQUE" ? "CHEQUE" : "VIRMT",
      produit: productOfInvoice(first.categorie, rows[0]?.nature ?? ""),
      status: "a_valider",
      source: "auto",
      invoiceIds: invoices.map((invoice) => invoice.legacyId),
      pieces: invoices.map((invoice) => `FACTURE N°: ${invoice.numero || "sans n°"}${invoice.dateFacture ? ` du ${formatDate(invoice.dateFacture)}` : ""}`),
      extra: { factures: invoices.map((invoice) => ({ n: invoice.numero, d: invoice.dateFacture ?? "" })), cree: { nom: actor.name, par: actor.id, le: new Date().toISOString() } },
    });
    for (const invoice of invoices) {
      await db.invoice.update({ where: { id: invoice.id }, data: { paymentRefs: [...new Set([...invoice.paymentRefs, created.ref])] } });
    }
    await logAction(actor, "Création demande de paiement", `${created.ref} – ${created.beneficiaire} – ${formatDA(total)}`);
    return ok({ id: created.id, ref: created.ref });
  } catch (error) {
    console.error("[dp] création :", error);
    return fail("La demande n'a pas pu être créée.", "DATABASE");
  }
}

/** Relie une demande à des factures fournisseurs (remplace la liaison précédente). */
export async function linkInvoices(actor: AuthUser, input: DpLinkInput): Promise<ActionResult<true>> {
  const guard = requireAccess(actor, "DP", "EDIT");
  if (!guard.success) return guard;
  try {
    const request = await db.paymentRequest.findUnique({ where: { id: input.id } });
    if (!request) return fail("Demande introuvable.", "NOT_FOUND");
    const chosen = await db.invoice.findMany({ where: { id: { in: input.invoiceIds }, sens: "DEBIT" } });
    const previous = await db.invoice.findMany({ where: { paymentRefs: { has: request.ref } } });
    await db.$transaction(async (tx) => {
      for (const invoice of previous) {
        if (!chosen.some((row) => row.id === invoice.id)) await tx.invoice.update({ where: { id: invoice.id }, data: { paymentRefs: invoice.paymentRefs.filter((ref) => ref !== request.ref) } });
      }
      for (const invoice of chosen) await tx.invoice.update({ where: { id: invoice.id }, data: { paymentRefs: [...new Set([...invoice.paymentRefs, request.ref])] } });
      await tx.paymentRequest.update({ where: { id: request.id }, data: { invoiceIds: chosen.map((invoice) => invoice.legacyId) } });
    });
    await logAction(actor, "Demande de paiement reliée", `${request.ref} → ${chosen.length} facture(s)`);
    return ok(true);
  } catch (error) {
    console.error("[dp] liaison :", error);
    return fail("La liaison n'a pas pu être enregistrée.", "DATABASE");
  }
}

/** Supprime une demande (administrateurs). Les factures reliées perdent la référence. */
export async function deleteRequest(actor: AuthUser, id: string): Promise<ActionResult<true>> {
  const guard = requireAdmin(actor);
  if (!guard.success) return guard;
  const request = await db.paymentRequest.findUnique({ where: { id } });
  if (!request) return fail("Demande introuvable.", "NOT_FOUND");
  const linked = await db.invoice.findMany({ where: { paymentRefs: { has: request.ref } } });
  await db.$transaction(async (tx) => {
    for (const invoice of linked) await tx.invoice.update({ where: { id: invoice.id }, data: { paymentRefs: invoice.paymentRefs.filter((ref) => ref !== request.ref) } });
    await tx.paymentRequest.delete({ where: { id } });
  });
  await logAction(actor, "Suppression demande de paiement", `${request.ref} – ${request.beneficiaire} – ${formatDA(decimalToNumber(request.montant))}`);
  return ok(true);
}

/** Factures fournisseurs en attente proposées pour une demande (recherche par tiers ou n°). */
export async function invoiceOptions(actor: AuthUser, search: string): Promise<ActionResult<DpInvoiceOption[]>> {
  const guard = requireAccess(actor, "DP");
  if (!guard.success) return guard;
  const rows = await db.invoice.findMany({
    where: {
      sens: "DEBIT",
      status: "EN_ATTENTE",
      payroll: false,
      ...(search ? { OR: [{ tiers: { contains: search, mode: "insensitive" } }, { numero: { contains: search, mode: "insensitive" } }, { categorie: { contains: search, mode: "insensitive" } }] } : {}),
    },
    orderBy: [{ tiers: "asc" }, { dateFacture: "asc" }],
    take: 150,
  });
  return ok(
    rows.map((row) => {
      const payable = toPayable(row);
      return {
        id: row.id,
        tiers: row.tiers,
        label: `${row.tiers || row.categorie}${row.numero ? ` · ${row.numero}` : ""}${payable.dateFacture ? ` · ${formatDate(payable.dateFacture)}` : ""}`,
        montant: remaining(payable) || payable.montant,
        dateFacture: payable.dateFacture,
        linkedRef: row.paymentRefs[0] ?? null,
      };
    }),
  );
}

async function productGuesser(): Promise<(beneficiaire: string) => DpProduct | ""> {
  const [requests, invoices] = await Promise.all([
    db.paymentRequest.findMany({ select: { beneficiaire: true, produit: true } }),
    db.invoice.findMany({ where: { sens: "DEBIT" }, select: { tiers: true, categorie: true } }),
  ]);
  const votes = new Map<string, Map<string, number>>();
  const vote = (name: string, product: string, weight: number): void => {
    const key = beneficiaryKey(name);
    if (!key || !product) return;
    const bucket = votes.get(key) ?? new Map<string, number>();
    bucket.set(product, (bucket.get(product) ?? 0) + weight);
    votes.set(key, bucket);
  };
  for (const request of requests) vote(request.beneficiaire, request.produit, 2);
  for (const invoice of invoices) vote(invoice.tiers, productFromCategory(invoice.categorie), 1);
  return (beneficiaire) => {
    const bucket = votes.get(beneficiaryKey(beneficiaire));
    if (!bucket) return "";
    const best = [...bucket.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
    return (["Assistance routière", "BDG", "Tiers payant", "Autre"] as const).find((product) => product === best) ?? "";
  };
}

function sameContent(existing: PaymentRequest, request: ImportedRequest): boolean {
  const clean = (value: string): string => value.replace(/\s+/g, " ").trim();
  return (
    clean(existing.beneficiaire) === clean(request.beneficiaire) &&
    clean(existing.mode) === clean(request.mode) &&
    clean(existing.produit) === clean(request.produit) &&
    clean(existing.adresse) === clean(request.adresse) &&
    Math.abs(decimalToNumber(existing.montant) - request.montant) <= 0.01 &&
    existing.pieces.map(clean).join("|") === request.pieces.map(clean).join("|")
  );
}

async function buildPlan(file: DpFile): Promise<ActionResult<{ plan: DpImportPlan; existing: Map<string, PaymentRequest> }>> {
  let sheets;
  try {
    sheets = readWorkbook(file.bytes);
  } catch (error) {
    console.error("[dp] lecture :", error);
    return fail("Ce fichier n'a pas pu être lu.", "VALIDATION");
  }
  const items = parseRequestWorkbook(sheets, await productGuesser());
  if (items.length === 0) return fail("Aucune demande trouvée : chaque feuille doit porter le n° de demande en E4 (modèle habituel).", "VALIDATION");
  const all = await db.paymentRequest.findMany({ where: { num: { in: items.map((item) => item.num) } }, orderBy: { legacyId: "asc" } });
  const byNum = new Map<number, PaymentRequest[]>();
  for (const request of all) byNum.set(request.num, [...(byNum.get(request.num) ?? []), request]);
  const seen = new Map<number, number>();
  const plan: DpImportPlan = { sheets: items.length, add: [], update: [], unchanged: 0, deduced: items.filter((item) => item.produitDeduit).length, unknownProduct: items.filter((item) => !item.produit).length };
  const existing = new Map<string, PaymentRequest>();
  for (const item of items) {
    const occurrence = seen.get(item.num) ?? 0;
    seen.set(item.num, occurrence + 1);
    const match = byNum.get(item.num)?.[occurrence];
    if (!match) {
      plan.add.push(item);
      continue;
    }
    if (!sameContent(match, item) && match.source !== "auto") {
      plan.update.push({ id: match.id, ref: match.ref, request: item });
      existing.set(match.id, match);
    } else {
      plan.unchanged += 1;
    }
  }
  return ok({ plan, existing });
}

/** Lit un classeur de demandes de paiement et prépare l'import (nouvelles, modifiées, inchangées). */
export async function previewRequestImport(actor: AuthUser, file: DpFile): Promise<ActionResult<DpImportPlan>> {
  const guard = requireAccess(actor, "DP", "EDIT");
  if (!guard.success) return guard;
  const built = await buildPlan(file);
  return built.success ? ok(built.data.plan) : built;
}

/** Applique l'import : crée les nouvelles demandes et met à jour les modifiées. Renvoie les demandes créées. */
export async function applyRequestImport(actor: AuthUser, file: DpFile): Promise<ActionResult<{ created: string[]; updated: number }>> {
  const guard = requireAccess(actor, "DP", "EDIT");
  if (!guard.success) return guard;
  const built = await buildPlan(file);
  if (!built.success) return built;
  const { plan, existing } = built.data;
  const created: string[] = [];
  try {
    for (const item of plan.add) {
      let suffix = "";
      while (await db.paymentRequest.findUnique({ where: { legacyId: `dp-${String(item.num).padStart(4, "0")}${suffix}` } })) suffix += "b";
      const row = await db.paymentRequest.create({
        data: {
          legacyId: `dp-${String(item.num).padStart(4, "0")}${suffix}`,
          num: item.num,
          ref: item.ref,
          beneficiaire: item.beneficiaire,
          adresse: item.adresse,
          montant: item.montant,
          nature: item.nature,
          mode: item.mode,
          produit: item.produit,
          status: "emise",
          source: "excel",
          pieces: item.pieces,
          extra: { factures: item.factures, typeAuto: item.produitDeduit, cree: { nom: actor.name, par: actor.id, le: new Date().toISOString() } },
        },
      });
      created.push(row.id);
    }
    for (const change of plan.update) {
      const base = existing.get(change.id);
      await db.paymentRequest.update({
        where: { id: change.id },
        data: {
          beneficiaire: change.request.beneficiaire,
          adresse: change.request.adresse,
          montant: change.request.montant,
          nature: change.request.nature,
          mode: change.request.mode,
          produit: change.request.produit,
          pieces: change.request.pieces,
          extra: { ...extraObject(base?.extra ?? {}), factures: change.request.factures } as Prisma.InputJsonObject,
        },
      });
    }
    await logAction(actor, "Import demandes de paiement", `${file.name} : ${plan.add.length} nouvelles, ${plan.update.length} modifiées`);
    return ok({ created, updated: plan.update.length });
  } catch (error) {
    console.error("[dp] import :", error);
    return fail(`L'import a échoué (${created.length} demande(s) déjà créée(s)).`, "DATABASE");
  }
}
