import { db } from "@/lib/db";
import type { Invoice } from "@/generated/prisma/client";
import { writeWorkbook } from "@/lib/spreadsheet";
import { requireAccess } from "@/features/access/services/access-rules";
import type { AuthUser } from "@/features/access/types";
import { isSplit, paidSum, remaining, toPayable, type PayableInvoice } from "@/features/invoices/services/invoice-balance";
import { authorOf } from "@/features/invoices/services/invoice-extra";
import { branchLabel } from "@/features/invoices/services/branch";
import { buildInvoiceWhere } from "@/features/invoices/services/invoice-service";
import type { InvoiceQuery } from "@/features/invoices/schemas";
import { logAction } from "@/features/journal/services/journal-service";
import { fail, ok, type ActionResult } from "@/types";
import { todayIso } from "@/utils/dates";

const EXPORT_LIMIT = 20_000;

/** Fichier prêt à télécharger. */
export interface ExportedFile {
  name: string;
  bytes: Uint8Array;
}

/** Filtres d'un export : ceux de la liste (la page est ignorée, toutes les lignes sont exportées). */
export type ExportQuery = InvoiceQuery;

/** Date `AAAA-MM-JJ` → date Excel (midi UTC : aucun décalage de jour possible). */
function excelDate(iso: string | null): Date | "" {
  return iso ? new Date(`${iso}T12:00:00Z`) : "";
}

function modeText(mode: Invoice["mode"]): string {
  return mode === "CHEQUE" ? "Chèque" : mode === "VIREMENT" ? "Virement" : mode === "VERSEMENT" ? "Versement" : "";
}

/** Code « TYPE » du classeur de suivi (VIRMT, CHEQUE, VRSMT). */
function modeCode(mode: Invoice["mode"]): string {
  return mode === "CHEQUE" ? "CHEQUE" : mode === "VIREMENT" ? "VIRMT" : mode === "VERSEMENT" ? "VRSMT" : "";
}

function stateText(invoice: PayableInvoice): string {
  if (invoice.status === "ANNULE") return "Annulé";
  if (invoice.status === "REGLE") return "Réglé";
  return paidSum(invoice) > 0 ? "Partiel" : "En attente";
}

function groupText(extra: Record<string, unknown>): string {
  const group = extra.groupe;
  if (!group || typeof group !== "object") return "";
  const g = group as Record<string, unknown>;
  const montant = Number(g.montant);
  const amount = Number.isFinite(montant) ? montant.toLocaleString("fr-FR", { minimumFractionDigits: 2 }) : "";
  return `${g.type === "CHEQUE" ? "Chèque" : "Virement"} ${String(g.numero ?? "")} – ${amount} DA (${String(g.nb ?? "")} factures)`.replace(/\s+/g, " ").trim();
}

function yearOf(row: Invoice): number | "" {
  return row.annee ?? "";
}

const LIST_HEADERS = [
  "Année", "Débit ou Crédit", "Client / catégorie", "Succursale", "Tiers", "Détail", "N° facture", "Date de dépôt facture", "Montant", "Débours", "Frais de gestion",
  "Reste à encaisser / payer", "État", "Date de règlement", "Mode", "N° de chèque", "Banque", "Paiement global", "Demande de paiement", "Nature", "Classe", "Saisi / modifié par",
];
const LIST_WIDTHS = [6, 9, 22, 16, 26, 40, 18, 12, 14, 14, 14, 14, 10, 12, 10, 14, 10, 30, 14, 18, 6, 18];

const SUIVI_HEADERS = [
  "Année", "BANQUE", "TYPE", "MONTANT", "N° facture", "N° DE CHEQUE", "Libellé", "Détail", "DATE DE REGLEMENT", "Débit ou Crédit", "Etat de la demande", "Débours", "Débours réglés le",
  "Frais de gestion", "Frais réglés le", "Reste à encaisser", "Date de dépôt facture", "commentaire", "Nature", "Classe",
];
const SUIVI_WIDTHS = [7, 8, 8, 16, 16, 14, 30, 44, 14, 10, 12, 14, 14, 14, 14, 14, 14, 20, 22, 7];

async function loadRows(actor: AuthUser, query: ExportQuery): Promise<ActionResult<Invoice[]>> {
  const where = buildInvoiceWhere(actor, query);
  if (!where) return fail("Vous n'avez accès à aucune facture.", "FORBIDDEN");
  try {
    const rows = await db.invoice.findMany({ where, orderBy: [{ annee: "asc" }, { ordre: "asc" }, { createdAt: "asc" }], take: EXPORT_LIMIT });
    return ok(rows);
  } catch (error) {
    console.error("[export] lecture impossible :", error);
    return fail("Les factures n'ont pas pu être lues.", "DATABASE");
  }
}

function listLabel(query: ExportQuery): string {
  const sens = query.sens === "CREDIT" ? "clients" : query.sens === "DEBIT" ? "fournisseurs" : "factures";
  const etat = query.status === "REGLE" ? "reglees" : query.status === "EN_ATTENTE" ? "en_attente" : "toutes";
  return `${sens}_${etat}_${query.annee ?? "toutes_annees"}`;
}

/** Export Excel de la liste affichée (mêmes filtres que l'écran, toutes les pages). */
export async function exportInvoiceList(actor: AuthUser, query: ExportQuery): Promise<ActionResult<ExportedFile>> {
  const allowed = requireAccess(actor, "A_EXPORT", "EDIT");
  if (!allowed.success) return allowed;
  const loaded = await loadRows(actor, query);
  if (!loaded.success) return loaded;
  if (loaded.data.length === 0) return fail("Rien à exporter avec ces filtres.", "NOT_FOUND");
  const rows = loaded.data.map((row) => {
    const invoice = toPayable(row);
    const split = isSplit(invoice);
    const extra = invoice.extra as Record<string, unknown>;
    return [
      yearOf(row),
      row.sens === "CREDIT" ? "Crédit" : "Débit",
      row.categorie,
      branchLabel(row),
      row.tiers,
      row.libelle,
      row.numero,
      excelDate(invoice.dateFacture),
      invoice.montant,
      split ? invoice.debours : "",
      split ? invoice.frais : "",
      remaining(invoice),
      stateText(invoice),
      excelDate(invoice.dateOperation),
      modeText(row.mode),
      row.cheque,
      row.banque,
      groupText(extra),
      row.paymentRefs.join(", "),
      row.nature,
      row.classe ?? "",
      authorOf(extra),
    ];
  });
  const bytes = writeWorkbook([{ name: "Factures", rows: [LIST_HEADERS, ...rows], widths: LIST_WIDTHS }]);
  await logAction(actor, "Export Excel", `Factures ${listLabel(query)} (${rows.length} lignes)`);
  return ok({ name: `Suivi_${listLabel(query)}_${todayIso()}.xlsx`, bytes });
}

/**
 * Export du suivi complet, dans les colonnes du classeur de suivi bancaire que l'équipe met à jour sous Excel
 * (même ordre et mêmes intitulés que le fichier réimportable avec « Importer le fichier de facturation »).
 */
export async function exportSuivi(actor: AuthUser, annee: number | undefined): Promise<ActionResult<ExportedFile>> {
  const allowed = requireAccess(actor, "A_EXPORT", "EDIT");
  if (!allowed.success) return allowed;
  const loaded = await loadRows(actor, { annee, page: 1 });
  if (!loaded.success) return loaded;
  if (loaded.data.length === 0) return fail("Rien à exporter.", "NOT_FOUND");
  const rows = loaded.data.map((row) => {
    const invoice = toPayable(row);
    const split = isSplit(invoice);
    return [
      yearOf(row),
      row.banque,
      modeCode(row.mode),
      invoice.montant,
      row.numero,
      row.cheque,
      row.tiers,
      row.libelle,
      excelDate(invoice.dateOperation),
      row.sens === "CREDIT" ? "Crédit" : "Débit",
      stateText(invoice),
      split ? invoice.debours : "",
      excelDate(typeof invoice.extra.regDebours === "string" ? invoice.extra.regDebours : null),
      split ? invoice.frais : "",
      excelDate(typeof invoice.extra.regFrais === "string" ? invoice.extra.regFrais : null),
      remaining(invoice),
      excelDate(invoice.dateFacture),
      row.categorie,
      row.nature,
      row.classe ?? "",
    ];
  });
  const bytes = writeWorkbook([{ name: annee ? `Suivi ${annee}` : "Suivi toutes années", rows: [SUIVI_HEADERS, ...rows], widths: SUIVI_WIDTHS }]);
  await logAction(actor, "Export Excel", `Suivi des créances ${annee ?? "toutes années"} (${rows.length} lignes)`);
  return ok({ name: `Suivi_creances_${annee ?? "toutes_annees"}_${todayIso()}.xlsx`, bytes });
}
