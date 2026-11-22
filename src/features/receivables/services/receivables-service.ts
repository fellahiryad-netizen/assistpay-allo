import { db } from "@/lib/db";
import { requireAccess } from "@/features/access/services/access-rules";
import type { AuthUser } from "@/features/access/types";
import { decimalToNumber } from "@/features/invoices/services/invoice-mapper";
import { buildReceivables, filterByActivity, toReceivableLine } from "@/features/receivables/lib/aggregate";
import type { ReceivablesQuery } from "@/features/receivables/schemas";
import type { ReceivableLine, ReceivablesSummary } from "@/features/receivables/types";
import { fail, ok, type ActionResult } from "@/types";
import { toIsoDate, todayIso } from "@/utils/dates";

/** Données de la page des créances. */
export interface ReceivablesData {
  summary: ReceivablesSummary;
  /** Années de facture présentes parmi les créances en attente (plus récente d'abord). */
  years: number[];
  query: ReceivablesQuery;
}

/** Données de l'export : synthèse et détail des factures. */
export interface ReceivablesDetail {
  summary: ReceivablesSummary;
  lines: ReceivableLine[];
  query: ReceivablesQuery;
}

/**
 * Factures partenaires en attente : sens crédit, non archivées, hors paie (même base que le tableau de bord).
 * Le droit « Factures partenaires » (FCLI) est exigé.
 */
async function loadLines(actor: AuthUser, query: ReceivablesQuery, today: string): Promise<ActionResult<ReceivableLine[]>> {
  const guard = requireAccess(actor, "FCLI");
  if (!guard.success) return guard;
  try {
    const rows = await db.invoice.findMany({
      where: { sens: "CREDIT", status: "EN_ATTENTE", archived: false, payroll: false, ...(query.annee ? { annee: query.annee } : {}) },
      select: { id: true, categorie: true, numero: true, libelle: true, montant: true, dateFacture: true, dateOperation: true },
      orderBy: [{ dateFacture: "asc" }, { numero: "asc" }],
    });
    const lines = rows.map((row) =>
      toReceivableLine(
        {
          id: row.id,
          categorie: row.categorie,
          numero: row.numero,
          libelle: row.libelle,
          montant: decimalToNumber(row.montant),
          dateFacture: toIsoDate(row.dateFacture),
          dateOperation: toIsoDate(row.dateOperation),
        },
        today,
      ),
    );
    return ok(filterByActivity(lines, query.activite ?? null));
  } catch (error) {
    console.error("[receivables] lecture impossible :", error);
    return fail("Les créances n'ont pas pu être lues.", "DATABASE");
  }
}

/**
 * Analyse des créances par compagnie (lecture seule, aucune écriture au journal).
 * Filtres : année de facture et activité.
 */
export async function getReceivables(actor: AuthUser, query: ReceivablesQuery): Promise<ActionResult<ReceivablesData>> {
  const today = todayIso();
  const lines = await loadLines(actor, query, today);
  if (!lines.success) return lines;
  try {
    const yearRows = await db.invoice.findMany({
      where: { sens: "CREDIT", status: "EN_ATTENTE", archived: false, payroll: false, annee: { not: null } },
      distinct: ["annee"],
      select: { annee: true },
      orderBy: { annee: "desc" },
    });
    const years = yearRows.flatMap((row) => (row.annee === null ? [] : [row.annee]));
    return ok({ summary: buildReceivables(lines.data, today), years, query });
  } catch (error) {
    console.error("[receivables] années impossibles à lire :", error);
    return fail("Les créances n'ont pas pu être lues.", "DATABASE");
  }
}

/** Détail des factures en attente et synthèse, pour l'export Excel (mêmes filtres que la page). */
export async function getReceivablesDetail(actor: AuthUser, query: ReceivablesQuery): Promise<ActionResult<ReceivablesDetail>> {
  const today = todayIso();
  const lines = await loadLines(actor, query, today);
  if (!lines.success) return lines;
  return ok({ summary: buildReceivables(lines.data, today), lines: lines.data, query });
}
