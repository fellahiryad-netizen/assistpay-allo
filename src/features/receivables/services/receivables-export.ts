import { writeWorkbook, type SheetToWrite } from "@/lib/spreadsheet";
import { requireAccess } from "@/features/access/services/access-rules";
import type { AuthUser } from "@/features/access/types";
import { AGING_BUCKETS } from "@/features/receivables/lib/aging";
import { ACTIVITY_LABELS } from "@/features/receivables/lib/company";
import type { ReceivablesQuery } from "@/features/receivables/schemas";
import { getReceivablesDetail } from "@/features/receivables/services/receivables-service";
import { fail, ok, type ActionResult } from "@/types";

/** Fichier prêt à télécharger. */
export interface ReceivablesFile {
  name: string;
  bytes: Uint8Array;
}

/** Date `AAAA-MM-JJ` → date Excel (midi UTC : aucun décalage de jour possible). */
function excelDate(iso: string | null): Date | "" {
  return iso ? new Date(`${iso}T12:00:00Z`) : "";
}

/**
 * Export Excel des créances : onglet « Par compagnie » (colonnes du tableau) et onglet « Factures » (détail).
 * Droits : consultation des factures partenaires et bouton d'export.
 */
export async function exportReceivables(actor: AuthUser, query: ReceivablesQuery): Promise<ActionResult<ReceivablesFile>> {
  const allowed = requireAccess(actor, "A_EXPORT", "EDIT");
  if (!allowed.success) return allowed;
  const detail = await getReceivablesDetail(actor, query);
  if (!detail.success) return detail;
  const { summary, lines } = detail.data;
  try {
    const agingHeads = AGING_BUCKETS.flatMap((bucket) => [`${bucket.label} (DA)`, `${bucket.label} (nb)`]);
    const byCompany: SheetToWrite = {
      name: "Par compagnie",
      widths: [18, 18, 9, 10, 18, 14, 12, 18, 18, 18, ...agingHeads.map(() => 16)],
      rows: [
        ["Compagnie", "Montant (DA)", "Part (%)", "Factures", "Plus ancienne (date)", "Ancienneté max (j)", "Plus ancienne (n°)", "Assistance (DA)", "BDG (DA)", "Autre (DA)", ...agingHeads],
        ...summary.companies.map((row) => [
          row.company,
          row.amount,
          row.share,
          row.count,
          excelDate(row.oldestDate),
          row.oldestDays,
          row.oldestNumero,
          row.byActivity.ASSISTANCE.amount,
          row.byActivity.BDG.amount,
          row.byActivity.AUTRE.amount,
          ...AGING_BUCKETS.flatMap((bucket) => [row.aging[bucket.key].amount, row.aging[bucket.key].count]),
        ]),
        [
          "TOTAL",
          summary.total,
          summary.companies.length > 0 ? 100 : 0,
          summary.count,
          "",
          null,
          "",
          summary.byActivity.ASSISTANCE.amount,
          summary.byActivity.BDG.amount,
          summary.byActivity.AUTRE.amount,
          ...AGING_BUCKETS.flatMap((bucket) => [summary.aging[bucket.key].amount, summary.aging[bucket.key].count]),
        ],
      ],
    };
    const invoices: SheetToWrite = {
      name: "Factures",
      widths: [18, 12, 24, 60, 14, 14, 18],
      rows: [
        ["Compagnie", "Activité", "N° facture", "Libellé", "Date de facture", "Ancienneté (j)", "Montant (DA)"],
        ...lines.map((line) => [line.company, ACTIVITY_LABELS[line.activity], line.numero, line.libelle, excelDate(line.dateFacture ?? line.dateOperation), line.ageDays, line.montant]),
      ],
    };
    const bytes = writeWorkbook([byCompany, invoices]);
    return ok({ name: `creances_par_compagnie_${summary.asOf}.xlsx`, bytes });
  } catch (error) {
    console.error("[receivables] export impossible :", error);
    return fail("Le fichier Excel n'a pas pu être préparé.", "DATABASE");
  }
}
