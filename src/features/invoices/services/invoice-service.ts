import { branchLabel } from "@/features/invoices/services/branch";
import { recordPayrollInHr } from "@/features/hr/services/hr-service";
import { fpInvoiceDeleted, fpSyncAmount } from "@/features/provider-invoices/services/fp-store";
import { notifyAdmins } from "@/features/system/services/admin-notices";
import { syncTransferAmount } from "@/features/transfers/services/transfer-service";
import { autoRequestForInvoice, detachDeletedInvoice, syncRequestsAmount } from "@/features/payment-requests/services/payment-request-service";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { can, requireAccess } from "@/features/access/services/access-rules";
import type { AuthUser } from "@/features/access/types";
import type { InvoiceInput, InvoiceQuery, MarkPaidInput, SetStatusInput } from "@/features/invoices/schemas";
import { toInvoiceDTO, decimalToNumber } from "@/features/invoices/services/invoice-mapper";
import { canOnInvoice, invoiceYear, isPayrollInvoice, moduleForSens, visibleSens } from "@/features/invoices/services/invoice-rules";
import {
  MODE_LABELS,
  SENS_LABELS,
  STATUS_LABELS,
  type InvoiceDTO,
  type InvoiceFilterOptions,
  type InvoiceListResult,
} from "@/features/invoices/types";
import { logAction } from "@/features/journal/services/journal-service";
import { fail, ok, type ActionResult } from "@/types";
import { fromIsoDate } from "@/utils/dates";
import { formatDA } from "@/utils/format";

const PAGE_SIZE = 50;
const NO_ACCESS = "Vous n'avez accès à aucune facture.";

/** Filtre de visibilité commun : sens autorisés et lignes de paie seulement avec l'accès RH. */
export function visibilityWhere(actor: AuthUser): Prisma.InvoiceWhereInput | null {
  const sens = visibleSens(actor);
  if (sens.length === 0) return null;
  return {
    sens: { in: sens },
    ...(can(actor, "RH") ? {} : { payroll: false }),
  };
}

function describe(invoice: { sens: "CREDIT" | "DEBIT"; tiers: string; numero: string; montant: number }): string {
  const numero = invoice.numero ? ` ${invoice.numero}` : "";
  return `${SENS_LABELS[invoice.sens]} – ${invoice.tiers}${numero} – ${formatDA(invoice.montant)}`;
}

/**
 * Recherche par montant : « 27500 », « 27 500,00 » ou « 27500.5 » (espaces, virgule et « DA » acceptés).
 * Sans décimales, tous les montants de la forme 27500,xx sont trouvés ; avec décimales, le montant exact.
 */
function amountConditions(q: string): Prisma.InvoiceWhereInput[] {
  const cleaned = q.replace(/[\s\u00a0\u202f]/g, "").replace(/da$/i, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return [];
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return [];
  return cleaned.includes(".") ? [{ montant: { gte: value - 0.005, lte: value + 0.005 } }] : [{ montant: { gte: value, lt: value + 1 } }];
}

/**
 * Recherche par montant dans une liste : le total de la facture, mais aussi le débours ou les frais (BDG) et le montant global.
 * Sans décimales, toutes les décimales sont acceptées ; avec décimales, le montant exact.
 */
export function amountFieldConditions(raw: string | undefined): Prisma.InvoiceWhereInput[] {
  if (!raw) return [];
  const cleaned = raw.replace(/[\s\u00a0\u202f]/g, "").replace(/da$/i, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return [{ id: "__aucun__" }];
  const value = Number(cleaned);
  const range = cleaned.includes(".") ? { gte: value - 0.005, lte: value + 0.005 } : { gte: value, lt: value + 1 };
  return [{ OR: [{ montant: range }, { debours: range }, { frais: range }, { montantGlobal: range }] }];
}

/** Identifiants des factures CAAT / CAAR d'une succursale (nom tel que proposé dans le filtre). */
async function branchInvoiceIds(actor: AuthUser, label: string): Promise<string[] | null> {
  const visibility = visibilityWhere(actor);
  if (!visibility) return null;
  const rows = await db.invoice.findMany({
    where: { AND: [visibility, { categorie: { in: ["CAAT", "CAAR"] } }] },
    select: { id: true, categorie: true, succursale: true, tiers: true, libelle: true },
  });
  return rows.filter((row) => branchLabel(row) === label).map((row) => row.id);
}

/** Comme `buildInvoiceWhere`, en résolvant aussi le filtre par succursale. */
export async function buildInvoiceWhereWithBranch(actor: AuthUser, query: Omit<InvoiceQuery, "page">): Promise<Prisma.InvoiceWhereInput | null> {
  const ids = query.succursale ? await branchInvoiceIds(actor, query.succursale) : undefined;
  return buildInvoiceWhere(actor, query, ids ?? undefined);
}

/** Filtre complet d'une recherche de factures (visibilité + filtres de la liste) ; null si aucun accès. */
export function buildInvoiceWhere(actor: AuthUser, query: Omit<InvoiceQuery, "page">, branchIds?: string[]): Prisma.InvoiceWhereInput | null {
  const visibility = visibilityWhere(actor);
  if (!visibility) return null;
  if (query.sens && !visibleSens(actor).includes(query.sens)) return null;
  return {
    AND: [
      visibility,
      query.sens ? { sens: query.sens } : {},
      query.status ? { status: query.status } : {},
      query.annee ? { annee: query.annee } : {},
      query.categorie ? { categorie: query.categorie } : {},
      branchIds ? { id: { in: branchIds } } : {},
      ...amountFieldConditions(query.m),
      query.q
        ? {
            OR: [
              ...amountConditions(query.q),
              { tiers: { contains: query.q, mode: "insensitive" } },
              { numero: { contains: query.q, mode: "insensitive" } },
              { libelle: { contains: query.q, mode: "insensitive" } },
              { categorie: { contains: query.q, mode: "insensitive" } },
              { succursale: { contains: query.q, mode: "insensitive" } },
            ],
          }
        : {},
    ],
  };
}

/** Id de la facture émise (imprimable) correspondant à chaque ligne, pour les utilisateurs ayant accès à la facturation. */
async function printableIds(actor: AuthUser, rows: ReadonlyArray<{ id: string; legacyId: string }>): Promise<Record<string, string>> {
  if (!can(actor, "FACT", "VIEW") || rows.length === 0) return {};
  const issued = await db.issuedInvoice.findMany({ where: { invoiceLegacyId: { in: rows.map((row) => row.legacyId) } }, select: { id: true, invoiceLegacyId: true } });
  const byLegacy = new Map(issued.flatMap((doc) => (doc.invoiceLegacyId ? [[doc.invoiceLegacyId, doc.id] as const] : [])));
  return Object.fromEntries(rows.flatMap((row) => (byLegacy.has(row.legacyId) ? [[row.id, byLegacy.get(row.legacyId) as string] as const] : [])));
}

/** Id de la facture imprimable liée à une facture du suivi (null s'il n'y en a pas). */
export async function printableIdFor(actor: AuthUser, invoice: { id: string; legacyId: string }): Promise<string | null> {
  return (await printableIds(actor, [invoice]))[invoice.id] ?? null;
}

/**
 * Recherche paginée des factures, limitée à ce que l'utilisateur a le droit de voir.
 * La recherche libre porte sur le tiers, le numéro, le libellé et la catégorie.
 */
export async function listInvoices(actor: AuthUser, query: InvoiceQuery): Promise<ActionResult<InvoiceListResult>> {
  let where = await buildInvoiceWhereWithBranch(actor, query);
  if (!where) return fail(NO_ACCESS, "FORBIDDEN");

  try {
    // Les totaux mensuels « Charges de personnel » appartiennent à l'onglet RH : jamais dans la liste.
    where = { AND: [where, { origine: { not: "rh" } }] };
    const [total, sum, rows] = await Promise.all([
      db.invoice.count({ where }),
      db.invoice.aggregate({ where, _sum: { montant: true } }),
      db.invoice.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { dateFacture: "desc" }],
        skip: (query.page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
    ]);
    const printable = await printableIds(actor, rows);
    return ok({
      items: rows.map(toInvoiceDTO),
      printable,
      total,
      page: query.page,
      pageSize: PAGE_SIZE,
      pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
      sumMontant: decimalToNumber(sum._sum.montant) ?? 0,
      canEdit: { CREDIT: can(actor, "FCLI", "EDIT"), DEBIT: can(actor, "FFOUR", "EDIT") },
    });
  } catch (error) {
    console.error("[invoices] recherche impossible :", error);
    return fail("Les factures n'ont pas pu être chargées.", "DATABASE");
  }
}

/** Années, catégories et sens disponibles pour les filtres de la liste. */
export async function getInvoiceFilterOptions(actor: AuthUser): Promise<ActionResult<InvoiceFilterOptions>> {
  const visibility = visibilityWhere(actor);
  if (!visibility) return fail(NO_ACCESS, "FORBIDDEN");
  try {
    const [years, categories, branchRows] = await Promise.all([
      db.invoice.findMany({ where: { ...visibility, annee: { not: null } }, distinct: ["annee"], select: { annee: true }, orderBy: { annee: "desc" } }),
      db.invoice.findMany({ where: { ...visibility, categorie: { not: "" }, origine: { not: "rh" } }, distinct: ["categorie"], select: { categorie: true }, orderBy: { categorie: "asc" } }),
      db.invoice.findMany({ where: { ...visibility, categorie: { in: ["CAAT", "CAAR"] } }, select: { categorie: true, succursale: true, tiers: true, libelle: true } }),
    ]);
    return ok({
      years: years.flatMap((row) => (row.annee === null ? [] : [row.annee])),
      categories: categories.map((row) => row.categorie),
      branches: [...new Set(branchRows.map((row) => branchLabel(row)).filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr")),
      sens: visibleSens(actor),
    });
  } catch (error) {
    console.error("[invoices] filtres impossibles :", error);
    return fail("Les filtres n'ont pas pu être chargés.", "DATABASE");
  }
}

/** Détail d'une facture (contrôle de visibilité inclus). */
export async function getInvoice(actor: AuthUser, id: string): Promise<ActionResult<{ invoice: InvoiceDTO; canEdit: boolean }>> {
  try {
    const row = await db.invoice.findUnique({ where: { id } });
    if (!row) return fail("Facture introuvable.", "NOT_FOUND");
    if (!canOnInvoice(actor, row, "VIEW")) return fail("Vous n'avez pas accès à cette facture.", "FORBIDDEN");
    return ok({ invoice: toInvoiceDTO(row), canEdit: canOnInvoice(actor, row, "EDIT") });
  } catch (error) {
    console.error("[invoices] lecture impossible :", error);
    return fail("La facture n'a pas pu être chargée.", "DATABASE");
  }
}

function toWriteData(input: InvoiceInput): Omit<Prisma.InvoiceUncheckedCreateInput, "legacyId"> {
  return {
    sens: input.sens,
    status: input.status,
    categorie: input.categorie,
    tiers: input.tiers,
    numero: input.numero,
    libelle: input.libelle,
    montant: input.montant,
    dateFacture: fromIsoDate(input.dateFacture),
    dateOperation: fromIsoDate(input.dateOperation),
    annee: invoiceYear(input.dateFacture, input.dateOperation),
    mode: input.mode,
    cheque: input.cheque,
    banque: input.banque,
    nature: input.nature,
    succursale: input.succursale,
    periode: input.periode,
    classe: input.sens === "CREDIT" ? 7 : 6,
    payroll: isPayrollInvoice(input.categorie, input.nature),
  };
}

/** Crée une facture ; refuse un doublon (même sens, tiers, numéro et catégorie). */
export async function createInvoice(actor: AuthUser, input: InvoiceInput): Promise<ActionResult<InvoiceDTO>> {
  const guard = requireAccess(actor, moduleForSens(input.sens), "EDIT");
  if (!guard.success) return guard;
  const data = toWriteData(input);
  if (data.payroll) {
    // Salaires, CNAS, G50, IRG, frais de mission : enregistrés directement dans l'onglet RH.
    const hr = await recordPayrollInHr(actor, { ...input });
    if (!hr.success) return hr;
    const aggregate = await db.invoice.findFirst({ where: { origine: "rh" }, orderBy: { updatedAt: "desc" } });
    if (!aggregate) return fail("L'écriture RH est enregistrée, mais son total n'a pas pu être relu.", "DATABASE");
    return ok(toInvoiceDTO(aggregate));
  }
  try {
    if (input.numero) {
      const duplicate = await db.invoice.findFirst({
        where: {
          sens: input.sens,
          numero: { equals: input.numero, mode: "insensitive" },
          tiers: { equals: input.tiers, mode: "insensitive" },
          categorie: input.categorie,
          status: { not: "ANNULE" },
        },
        select: { id: true },
      });
      if (duplicate) return fail(`La facture ${input.numero} existe déjà pour ${input.tiers}.`, "CONFLICT");
    }
    const row = await db.invoice.create({
      data: { ...data, legacyId: `n-${crypto.randomUUID()}`, origine: "saisie", createdById: actor.id, updatedById: actor.id },
    });
    const dto = toInvoiceDTO(row);
    await logAction(actor, "Ajout facture", describe(dto));
    // Une facture fournisseur génère tout de suite sa demande de paiement.
    await autoRequestForInvoice(actor, row.id);
    return ok(dto);
  } catch (error) {
    console.error("[invoices] création impossible :", error);
    return fail("La facture n'a pas pu être enregistrée.", "DATABASE");
  }
}

/**
 * Écriture protégée contre les modifications simultanées : la facture n'est mise à jour que si personne ne l'a modifiée
 * depuis sa lecture (comparaison de `updatedAt`). Renvoie `null` si quelqu'un est passé entre-temps.
 */
async function guardedUpdate(current: { id: string; updatedAt: Date }, data: Prisma.InvoiceUncheckedUpdateManyInput): Promise<Awaited<ReturnType<typeof db.invoice.findUnique>> | null> {
  const result = await db.invoice.updateMany({ where: { id: current.id, updatedAt: current.updatedAt }, data });
  if (result.count === 0) return null;
  return db.invoice.findUnique({ where: { id: current.id } });
}

const CONCURRENT_MESSAGE = "Cette facture vient d'être modifiée par une autre personne. Rechargez la page puis recommencez.";

/** Modifie une facture existante. Changer de sens demande le droit de modification des deux côtés. */
export async function updateInvoice(actor: AuthUser, id: string, input: InvoiceInput): Promise<ActionResult<InvoiceDTO>> {
  try {
    const current = await db.invoice.findUnique({ where: { id } });
    if (!current) return fail("Facture introuvable.", "NOT_FOUND");
    if (!canOnInvoice(actor, current, "EDIT")) return fail("Vous ne pouvez pas modifier cette facture.", "FORBIDDEN");
    const guard = requireAccess(actor, moduleForSens(input.sens), "EDIT");
    if (!guard.success) return guard;
    const data = toWriteData(input);
    if (data.payroll && !can(actor, "RH", "EDIT")) return fail("Les lignes de paie sont réservées à l'accès RH.", "FORBIDDEN");
    const row = await guardedUpdate(current, { ...data, classe: current.classe ?? data.classe, updatedById: actor.id });
    if (!row) return fail(CONCURRENT_MESSAGE, "CONFLICT");
    const dto = toInvoiceDTO(row);
    await logAction(actor, "Modification facture", describe(dto));
    // Le montant corrigé est reporté sur la demande de paiement et sur la demande de facture prestataire.
    if (row.sens === "DEBIT" && !row.montant.equals(current.montant)) {
      const changes = await syncRequestsAmount(actor, row);
      await fpSyncAmount(actor, row.legacyId, dto.montant);
      // La correction se répercute sur l'état des virements lié ; les administrateurs en sont alertés.
      for (const change of changes) {
        const transfer = await syncTransferAmount(actor, change);
        if (!transfer.ref && !change.sent) continue;
        const lignes = [
          `Facture ${current.numero || "sans numéro"} – ${current.tiers} : ${formatDA(decimalToNumber(current.montant))} → ${formatDA(dto.montant)} (modifiée par ${actor.name}).`,
          `Demande de paiement ${change.ref} corrigée : ${formatDA(change.before)} → ${formatDA(change.after)}.`,
          transfer.manual
            ? `État de virement ${transfer.ref || change.sent} : la ligne n'a pas pu être corrigée automatiquement, à vérifier à la main.`
            : `État de virement ${transfer.ref} corrigé automatiquement${transfer.wasValidated ? " : il était validé, il repasse en attente et doit être revalidé puis renvoyé à la banque" : ""}.`,
        ];
        await notifyAdmins({ titre: "Facture fournisseur corrigée après virement", lignes, par: actor.name });
      }
    }
    return ok(dto);
  } catch (error) {
    console.error("[invoices] modification impossible :", error);
    return fail("La facture n'a pas pu être modifiée.", "DATABASE");
  }
}

/** Marque une facture comme réglée à la date, par le mode et avec la référence indiqués. */
export async function markInvoicePaid(actor: AuthUser, input: MarkPaidInput): Promise<ActionResult<InvoiceDTO>> {
  try {
    const current = await db.invoice.findUnique({ where: { id: input.id } });
    if (!current) return fail("Facture introuvable.", "NOT_FOUND");
    if (!canOnInvoice(actor, current, "EDIT")) return fail("Vous ne pouvez pas régler cette facture.", "FORBIDDEN");
    if (current.status === "ANNULE") return fail("Une facture annulée ne peut pas être réglée.", "CONFLICT");
    const row = await guardedUpdate(current, {
      status: "REGLE",
      dateOperation: fromIsoDate(input.date),
      mode: input.mode,
      cheque: input.reference,
      banque: input.banque || current.banque,
      updatedById: actor.id,
    });
    if (!row) return fail(CONCURRENT_MESSAGE, "CONFLICT");
    const dto = toInvoiceDTO(row);
    await logAction(actor, "Règlement facture", `${describe(dto)} – ${MODE_LABELS[input.mode]} du ${input.date}`);
    return ok(dto);
  } catch (error) {
    console.error("[invoices] règlement impossible :", error);
    return fail("Le règlement n'a pas pu être enregistré.", "DATABASE");
  }
}

/** Remet une facture en attente ou l'annule. */
export async function setInvoiceStatus(actor: AuthUser, input: SetStatusInput): Promise<ActionResult<InvoiceDTO>> {
  try {
    const current = await db.invoice.findUnique({ where: { id: input.id } });
    if (!current) return fail("Facture introuvable.", "NOT_FOUND");
    if (!canOnInvoice(actor, current, "EDIT")) return fail("Vous ne pouvez pas modifier cette facture.", "FORBIDDEN");
    const row = await guardedUpdate(current, { status: input.status, updatedById: actor.id });
    if (!row) return fail(CONCURRENT_MESSAGE, "CONFLICT");
    const dto = toInvoiceDTO(row);
    await logAction(actor, `Facture passée « ${STATUS_LABELS[input.status]} »`, describe(dto));
    return ok(dto);
  } catch (error) {
    console.error("[invoices] changement d'état impossible :", error);
    return fail("L'état n'a pas pu être modifié.", "DATABASE");
  }
}

/**
 * Supprime une facture. Refusé si elle est réglée (la remettre d'abord en attente ou l'annuler) :
 * le journal garde la trace de la suppression.
 */
export async function deleteInvoice(actor: AuthUser, id: string): Promise<ActionResult<{ id: string }>> {
  try {
    const current = await db.invoice.findUnique({ where: { id } });
    if (!current) return fail("Facture introuvable.", "NOT_FOUND");
    if (!canOnInvoice(actor, current, "EDIT")) return fail("Vous ne pouvez pas supprimer cette facture.", "FORBIDDEN");
    if (current.status === "REGLE") return fail("Cette facture est réglée : remettez-la d'abord en attente avant de la supprimer.", "CONFLICT");
    const dto = toInvoiceDTO(current);
    await db.invoice.delete({ where: { id } });
    await logAction(actor, "Suppression facture", describe(dto));
    // La demande de paiement et la demande de facture prestataire liées suivent la suppression.
    if (current.sens === "DEBIT") {
      await detachDeletedInvoice(actor, current);
      await fpInvoiceDeleted(actor, current.legacyId);
    }
    return ok({ id });
  } catch (error) {
    console.error("[invoices] suppression impossible :", error);
    return fail("La facture n'a pas pu être supprimée.", "DATABASE");
  }
}
