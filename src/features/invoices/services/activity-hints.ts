import { db } from "@/lib/db";
import { buildActivityHints, needsActivityHints, type ActivityHints } from "@/features/invoices/lib/activity";

/** Indices d'activité par tiers, calculés sur toutes les factures fournisseurs (hors lignes de paie). */
export async function loadActivityHints(): Promise<ActivityHints> {
  const rows = await db.invoice.findMany({ where: { sens: "DEBIT", payroll: false }, select: { tiers: true, categorie: true, extra: true } });
  return buildActivityHints(rows);
}

/** Indices nécessaires à l'affichage de ces lignes : `undefined` (aucune requête) si aucune n'a une catégorie ambiguë. */
export async function activityHintsFor(rows: ReadonlyArray<{ sens: string; categorie: string; extra: unknown }>): Promise<ActivityHints | undefined> {
  return rows.some((row) => row.sens === "DEBIT" && needsActivityHints(row)) ? loadActivityHints() : undefined;
}
