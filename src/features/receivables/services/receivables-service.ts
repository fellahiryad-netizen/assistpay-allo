import { db } from "@/lib/db";
import { can, requireAccess } from "@/features/access/services/access-rules";
import type { AuthUser } from "@/features/access/types";
import { decimalToNumber } from "@/features/invoices/services/invoice-mapper";
import { partnerKey } from "@/features/partners/services/partner-service";
import { buildReceivables, filterByActivity } from "@/features/receivables/lib/aggregate";
import { buildDetail, parseScope, toDetailLine } from "@/features/receivables/lib/detail";
import type { ReceivablesQuery } from "@/features/receivables/schemas";
import type { DetailLine, ReceivableDetail, ReceivablesSummary, ReminderRef } from "@/features/receivables/types";
import { fail, ok, type ActionResult } from "@/types";
import { toIsoDate, todayIso } from "@/utils/dates";

/** Données de la page des créances. */
export interface ReceivablesData {
  summary: ReceivablesSummary;
  /** Années de facture présentes parmi les créances en attente (plus récente d'abord). */
  years: number[];
  query: ReceivablesQuery;
  /** Panneau de détail demandé par `?detail=`, `null` sinon. */
  detail: ReceivableDetail | null;
  /** L'utilisateur peut ouvrir les fiches partenaires (lien « Préparer la relance »). */
  canRelance: boolean;
}

/** Données de l'export : synthèse et détail des factures. */
export interface ReceivablesDetail {
  summary: ReceivablesSummary;
  lines: DetailLine[];
  query: ReceivablesQuery;
}

/** Détail d'un périmètre, prêt pour l'export Excel ou l'impression. */
export interface ReceivableDetailData {
  asOf: string;
  detail: ReceivableDetail;
  query: ReceivablesQuery;
}

/**
 * Factures partenaires en attente : sens crédit, non archivées, hors paie (même base que le tableau de bord).
 * Le droit « Factures partenaires » (FCLI) est exigé.
 */
async function loadLines(actor: AuthUser, query: ReceivablesQuery, today: string): Promise<ActionResult<DetailLine[]>> {
  const guard = requireAccess(actor, "FCLI");
  if (!guard.success) return guard;
  try {
    const rows = await db.invoice.findMany({
      where: { sens: "CREDIT", status: "EN_ATTENTE", archived: false, payroll: false, ...(query.annee ? { annee: query.annee } : {}) },
      select: { id: true, categorie: true, tiers: true, succursale: true, periode: true, numero: true, libelle: true, montant: true, dateFacture: true, dateOperation: true },
      orderBy: [{ dateFacture: "asc" }, { numero: "asc" }],
    });
    const lines = rows.map((row) =>
      toDetailLine(
        {
          id: row.id,
          categorie: row.categorie,
          tiers: row.tiers,
          succursale: row.succursale,
          periode: row.periode,
          partner: partnerKey(row.categorie),
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

/** Relances enregistrées (module Partenaires) pour les partenaires donnés ; vide sans le droit « Partenaires ». */
async function loadReminders(actor: AuthUser, partners: readonly string[]): Promise<ReminderRef[]> {
  if (!can(actor, "PART") || partners.length === 0) return [];
  try {
    const rows = await db.reminder.findMany({ where: { partenaire: { in: [...partners] } }, orderBy: { sentAt: "desc" }, take: 500, select: { partenaire: true, sentAt: true, payload: true } });
    return rows.map((row) => {
      const payload = row.payload && typeof row.payload === "object" && !Array.isArray(row.payload) ? (row.payload as Record<string, unknown>) : {};
      const invoices = Array.isArray(payload.factures) ? payload.factures.filter((id): id is string => typeof id === "string") : [];
      return { partenaire: row.partenaire, sentAt: row.sentAt.toISOString(), succursale: typeof payload.succursale === "string" ? payload.succursale : "", factures: invoices };
    });
  } catch (error) {
    console.error("[receivables] relances illisibles :", error);
    return [];
  }
}

async function detailFor(actor: AuthUser, query: ReceivablesQuery, lines: readonly DetailLine[]): Promise<ReceivableDetail | null> {
  const scope = parseScope(query.detail);
  if (!scope) return null;
  const partners = [...new Set(lines.filter((line) => line.company === scope.company).map((line) => line.partner))];
  const reminders = await loadReminders(actor, partners);
  return buildDetail(lines, scope, query.anc ?? null, reminders);
}

/**
 * Analyse des créances par compagnie (lecture seule, aucune écriture au journal).
 * Filtres : année de facture et activité ; avec `detail`, ajoute le détail par succursale du périmètre cliqué.
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
    const detail = await detailFor(actor, query, lines.data);
    return ok({ summary: buildReceivables(lines.data, today), years, query, detail, canRelance: can(actor, "PART") });
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

/** Détail par succursale d'un périmètre (`query.detail` obligatoire), pour l'export Excel et l'impression. */
export async function getReceivableDetail(actor: AuthUser, query: ReceivablesQuery): Promise<ActionResult<ReceivableDetailData>> {
  const today = todayIso();
  if (!parseScope(query.detail)) return fail("Choisissez d'abord une compagnie dans le tableau.", "VALIDATION");
  const lines = await loadLines(actor, query, today);
  if (!lines.success) return lines;
  const detail = await detailFor(actor, query, lines.data);
  if (!detail) return fail("Choisissez d'abord une compagnie dans le tableau.", "VALIDATION");
  return ok({ asOf: today, detail, query });
}
