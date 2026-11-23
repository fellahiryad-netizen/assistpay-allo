import { writeWorkbook, type SheetToWrite } from "@/lib/spreadsheet";
import { requireAccess } from "@/features/access/services/access-rules";
import type { AuthUser } from "@/features/access/types";
import { agingLabelOf, scopeLabel } from "@/features/receivables/lib/detail";
import type { ReceivablesQuery } from "@/features/receivables/schemas";
import { getReceivableDetail } from "@/features/receivables/services/receivables-service";
import type { ReceivablesFile } from "@/features/receivables/services/receivables-export";
import { fail, ok, type ActionResult } from "@/types";

function excelDate(iso: string | null): Date | "" {
  return iso ? new Date(`${iso}T12:00:00Z`) : "";
}

/** Nom d'onglet Excel valide (31 caractères, sans caractères interdits) et unique. */
function sheetName(label: string, used: Set<string>): string {
  const base = (label.replace(/[\\/?*[\]:]/g, " ").replace(/\s+/g, " ").trim() || "Succursale").slice(0, 31);
  let name = base;
  let n = 2;
  while (used.has(name.toLowerCase())) {
    const suffix = ` (${n})`;
    name = `${base.slice(0, 31 - suffix.length)}${suffix}`;
    n += 1;
  }
  used.add(name.toLowerCase());
  return name;
}

/**
 * Export Excel du détail d'une compagnie (ou compagnie × activité) : onglet « Récapitulatif » puis un onglet par succursale.
 * Droits : factures partenaires et bouton d'export. Lecture seule, rien n'est écrit au journal.
 */
export async function exportReceivableDetail(actor: AuthUser, query: ReceivablesQuery): Promise<ActionResult<ReceivablesFile>> {
  const allowed = requireAccess(actor, "A_EXPORT", "EDIT");
  if (!allowed.success) return allowed;
  const result = await getReceivableDetail(actor, query);
  if (!result.success) return result;
  const { detail, asOf } = result.data;
  try {
    const used = new Set<string>(["récapitulatif"]);
    const summary: SheetToWrite = {
      name: "Récapitulatif",
      widths: [28, 10, 18, 10, 18, 16, 18],
      rows: [
        [`${scopeLabel(detail.scope)} : factures en attente au ${asOf}${detail.minAge ? ` (plus de ${detail.minAge} jours ou sans date)` : ""}`],
        [],
        ["Succursale", "Factures", "Montant (DA)", "Part (%)", "Plus ancienne (date)", "Ancienneté max (j)", "Dernière relance"],
        ...detail.branches.map((branch) => [branch.label, branch.count, branch.amount, branch.share, excelDate(branch.oldestDate), branch.oldestDays, excelDate(branch.lastReminder)]),
        ["TOTAL", detail.count, detail.total, detail.branches.length > 0 ? 100 : 0, "", null, ""],
      ],
    };
    const sheets: SheetToWrite[] = detail.branches.map((branch) => ({
      name: sheetName(branch.label, used),
      widths: [24, 60, 18, 14, 14, 16, 18, 16],
      rows: [
        ["N° facture", "Libellé", "Période", "Date de facture", "Ancienneté (j)", "Tranche", "Montant (DA)", "Dernière relance"],
        ...branch.invoices.map((invoice) => [invoice.numero, invoice.libelle, invoice.periode, excelDate(invoice.date), invoice.ageDays, agingLabelOf(invoice.aging), invoice.amount, excelDate(invoice.lastReminder)]),
        ["Sous-total", `${branch.count} facture(s)`, "", "", null, "", branch.amount, ""],
      ],
    }));
    const slug = scopeLabel(detail.scope).replace(/[^A-Za-z0-9]+/g, "_");
    return ok({ name: `creances_${slug}_${asOf}.xlsx`, bytes: writeWorkbook([summary, ...sheets]) });
  } catch (error) {
    console.error("[receivables] export du détail impossible :", error);
    return fail("Le fichier Excel n'a pas pu être préparé.", "DATABASE");
  }
}
