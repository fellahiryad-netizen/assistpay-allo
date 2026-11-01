import { db } from "@/lib/db";
import type { AuthUser } from "@/features/access/types";
import type { InvoiceQuery } from "@/features/invoices/schemas";
import { decimalToNumber, toInvoiceDTO } from "@/features/invoices/services/invoice-mapper";
import { buildInvoiceWhere } from "@/features/invoices/services/invoice-service";
import type { InvoiceDTO } from "@/features/invoices/types";
import { fail, ok, type ActionResult } from "@/types";
import { round2 } from "@/utils/amounts";

/** Années de l'historique (classeur de suivi bancaire d'origine). */
export const HISTORY_YEARS = [2023, 2024, 2025] as const;
const PAGE_SIZE = 50;

/** Requête de l'historique : année (ou toutes) et filtres de la liste. */
export type HistoryQuery = Omit<InvoiceQuery, "annee"> & { annee: number | null };

/** Chiffres d'une année de l'historique. */
export interface HistoryYear {
  annee: number;
  credit: { n: number; reglees: number; attente: number; nAttente: number };
  debit: { n: number; reglees: number; attente: number; nAttente: number };
}

/** Historique : synthèse par année, créances en attente par catégorie et lignes détaillées. */
export interface HistoryData {
  years: HistoryYear[];
  pending: Array<{ label: string; amount: number; count: number }>;
  items: InvoiceDTO[];
  total: number;
  sum: number;
  page: number;
  pageCount: number;
}

/** Historique 2023–2025 : synthèse, créances en attente et détail ligne à ligne. */
export async function getHistory(actor: AuthUser, query: HistoryQuery): Promise<ActionResult<HistoryData>> {
  const { annee, ...rest } = query;
  const base = buildInvoiceWhere(actor, { ...rest, status: undefined, categorie: undefined, q: undefined, sens: undefined });
  if (!base) return fail("Vous n'avez accès à aucune facture.", "FORBIDDEN");
  const list = buildInvoiceWhere(actor, rest);
  if (!list) return fail("Vous n'avez accès à aucune facture.", "FORBIDDEN");
  const yearsFilter = annee ? { annee } : { annee: { gte: HISTORY_YEARS[0], lte: HISTORY_YEARS[HISTORY_YEARS.length - 1] } };
  try {
    const [grouped, pendingRows, total, sum, rows] = await Promise.all([
      db.invoice.groupBy({ by: ["annee", "sens", "status"], where: { AND: [base, { annee: { gte: HISTORY_YEARS[0], lte: HISTORY_YEARS[HISTORY_YEARS.length - 1] } }] }, _sum: { montant: true }, _count: { _all: true } }),
      db.invoice.groupBy({ by: ["categorie"], where: { AND: [base, yearsFilter, { sens: "CREDIT", status: "EN_ATTENTE" }] }, _sum: { montant: true }, _count: { _all: true } }),
      db.invoice.count({ where: { AND: [list, yearsFilter] } }),
      db.invoice.aggregate({ where: { AND: [list, yearsFilter] }, _sum: { montant: true } }),
      db.invoice.findMany({
        where: { AND: [list, yearsFilter] },
        orderBy: [{ dateOperation: { sort: "asc", nulls: "last" } }, { dateFacture: "asc" }, { createdAt: "asc" }],
        skip: (query.page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
    ]);
    const years: HistoryYear[] = HISTORY_YEARS.map((year) => {
      const empty = () => ({ n: 0, reglees: 0, attente: 0, nAttente: 0 });
      const out: HistoryYear = { annee: year, credit: empty(), debit: empty() };
      for (const row of grouped.filter((entry) => entry.annee === year)) {
        const target = row.sens === "CREDIT" ? out.credit : out.debit;
        const amount = decimalToNumber(row._sum.montant) ?? 0;
        target.n += row._count._all;
        if (row.status === "REGLE") target.reglees = round2(target.reglees + amount);
        if (row.status === "EN_ATTENTE") {
          target.attente = round2(target.attente + amount);
          target.nAttente += row._count._all;
        }
      }
      return out;
    });
    return ok({
      years,
      pending: pendingRows.map((row) => ({ label: row.categorie || "Sans catégorie", amount: decimalToNumber(row._sum.montant) ?? 0, count: row._count._all })).filter((row) => row.amount > 0),
      items: rows.map(toInvoiceDTO),
      total,
      sum: decimalToNumber(sum._sum.montant) ?? 0,
      page: query.page,
      pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    });
  } catch (error) {
    console.error("[historique] lecture impossible :", error);
    return fail("L'historique n'a pas pu être chargé.", "DATABASE");
  }
}
