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
function visibilityWhere(actor: AuthUser): Prisma.InvoiceWhereInput | null {
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
 * Recherche paginée des factures, limitée à ce que l'utilisateur a le droit de voir.
 * La recherche libre porte sur le tiers, le numéro, le libellé et la catégorie.
 */
export async function listInvoices(actor: AuthUser, query: InvoiceQuery): Promise<ActionResult<InvoiceListResult>> {
  const visibility = visibilityWhere(actor);
  if (!visibility) return fail(NO_ACCESS, "FORBIDDEN");
  if (query.sens && !visibleSens(actor).includes(query.sens)) return fail(NO_ACCESS, "FORBIDDEN");

  const where: Prisma.InvoiceWhereInput = {
    AND: [
      visibility,
      query.sens ? { sens: query.sens } : {},
      query.status ? { status: query.status } : {},
      query.annee ? { annee: query.annee } : {},
      query.categorie ? { categorie: query.categorie } : {},
      query.q
        ? {
            OR: [
              { tiers: { contains: query.q, mode: "insensitive" } },
              { numero: { contains: query.q, mode: "insensitive" } },
              { libelle: { contains: query.q, mode: "insensitive" } },
              { categorie: { contains: query.q, mode: "insensitive" } },
            ],
          }
        : {},
    ],
  };

  try {
    const [total, sum, rows] = await Promise.all([
      db.invoice.count({ where }),
      db.invoice.aggregate({ where, _sum: { montant: true } }),
      db.invoice.findMany({
        where,
        orderBy: [{ dateOperation: { sort: "desc", nulls: "first" } }, { dateFacture: "desc" }, { createdAt: "desc" }],
        skip: (query.page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
    ]);
    return ok({
      items: rows.map(toInvoiceDTO),
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
    const [years, categories] = await Promise.all([
      db.invoice.findMany({ where: { ...visibility, annee: { not: null } }, distinct: ["annee"], select: { annee: true }, orderBy: { annee: "desc" } }),
      db.invoice.findMany({ where: { ...visibility, categorie: { not: "" } }, distinct: ["categorie"], select: { categorie: true }, orderBy: { categorie: "asc" } }),
    ]);
    return ok({
      years: years.flatMap((row) => (row.annee === null ? [] : [row.annee])),
      categories: categories.map((row) => row.categorie),
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
  if (data.payroll && !can(actor, "RH", "EDIT")) return fail("Les lignes de paie sont réservées à l'accès RH.", "FORBIDDEN");
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
    return ok(dto);
  } catch (error) {
    console.error("[invoices] création impossible :", error);
    return fail("La facture n'a pas pu être enregistrée.", "DATABASE");
  }
}

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
    const row = await db.invoice.update({ where: { id }, data: { ...data, classe: current.classe ?? data.classe, updatedById: actor.id } });
    const dto = toInvoiceDTO(row);
    await logAction(actor, "Modification facture", describe(dto));
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
    const row = await db.invoice.update({
      where: { id: input.id },
      data: {
        status: "REGLE",
        dateOperation: fromIsoDate(input.date),
        mode: input.mode,
        cheque: input.reference,
        banque: input.banque || current.banque,
        updatedById: actor.id,
      },
    });
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
    const row = await db.invoice.update({ where: { id: input.id }, data: { status: input.status, updatedById: actor.id } });
    const dto = toInvoiceDTO(row);
    await logAction(actor, `Facture passée « ${STATUS_LABELS[input.status]} »`, describe(dto));
    return ok(dto);
  } catch (error) {
    console.error("[invoices] changement d'état impossible :", error);
    return fail("L'état n'a pas pu être modifié.", "DATABASE");
  }
}
