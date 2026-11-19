import { db } from "@/lib/db";
import { requireAccess } from "@/features/access/services/access-rules";
import type { AuthUser } from "@/features/access/types";
import { activityOf, ACTIVITY_LABELS, buildActivityHints } from "@/features/invoices/lib/activity";
import type { ChangeProviderActivityInput } from "@/features/invoices/schemas";
import { extraWithActivity } from "@/features/invoices/services/invoice-extra";
import { logAction } from "@/features/journal/services/journal-service";
import { fail, ok, type ActionResult } from "@/types";

/** Levée dans la transaction quand une facture a été modifiée par quelqu'un d'autre : annule tout. */
class ConcurrentChangeError extends Error {}

/**
 * Change l'activité de toutes les factures impayées d'un prestataire qui appartiennent à l'activité d'origine
 * (même périmètre que le tableau des prestataires : année éventuelle, lignes de paie exclues).
 * L'activité est écrite dans `extra.activite` en conservant les autres clés. `expected` est le nombre annoncé dans la confirmation :
 * s'il a changé entre-temps, rien n'est modifié. L'écriture est atomique : si une seule facture a été modifiée par quelqu'un d'autre
 * pendant l'opération (garde sur `updatedAt`), la transaction est annulée et aucune facture n'est touchée.
 */
export async function changeProviderActivity(actor: AuthUser, input: ChangeProviderActivityInput): Promise<ActionResult<{ changed: number }>> {
  const guard = requireAccess(actor, "FFOUR", "EDIT");
  if (!guard.success) return guard;
  try {
    const rows = await db.invoice.findMany({ where: { sens: "DEBIT", payroll: false } });
    const hints = buildActivityHints(rows);
    const wanted = input.tiers.trim() || "Sans nom";
    const targets = rows.filter(
      (row) =>
        row.status === "EN_ATTENTE" &&
        (!input.year || row.annee === input.year) &&
        !/charges de personnel/i.test(row.categorie) &&
        (row.tiers.trim() || "Sans nom") === wanted &&
        activityOf({ categorie: row.categorie, extra: row.extra, nature: row.nature, tiers: row.tiers, libelle: row.libelle }, hints) === input.from,
    );
    if (targets.length === 0) return fail("Aucune facture impayée à modifier pour ce prestataire dans cette activité.", "NOT_FOUND");
    if (targets.length !== input.expected) return fail(`Le nombre de factures concernées a changé (${targets.length} au lieu de ${input.expected}). Rechargez la page puis recommencez.`, "CONFLICT");
    await db.$transaction(async (tx) => {
      for (const row of targets) {
        const result = await tx.invoice.updateMany({ where: { id: row.id, updatedAt: row.updatedAt }, data: { extra: extraWithActivity(row.extra, input.to), updatedById: actor.id } });
        if (result.count !== 1) throw new ConcurrentChangeError(row.id);
      }
    });
    const ids = targets.map((row) => row.legacyId).join(", ");
    await logAction(
      actor,
      "Changement d'activité prestataire",
      `${wanted} : ${targets.length} facture(s) impayée(s), ${ACTIVITY_LABELS[input.from]} → ${ACTIVITY_LABELS[input.to]}${input.year ? ` (année ${input.year})` : ""} ; factures : ${ids}`,
      false,
      {
        entity: "Invoice",
        entityId: targets.length === 1 ? (targets[0]?.legacyId ?? wanted) : wanted,
        avant: { activité: ACTIVITY_LABELS[input.from], factures: ids },
        apres: { activité: ACTIVITY_LABELS[input.to], factures: ids },
      },
    );
    return ok({ changed: targets.length });
  } catch (error) {
    if (error instanceof ConcurrentChangeError) return fail("Une facture a changé entre-temps : rien n'a été modifié. Rechargez la page puis recommencez.", "CONFLICT");
    console.error("[prestataires] changement d'activité impossible :", error);
    return fail("L'activité n'a pas pu être modifiée. Rien n'a été modifié, recommencez.", "DATABASE");
  }
}
