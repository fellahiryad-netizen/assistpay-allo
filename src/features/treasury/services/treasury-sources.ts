import { db } from "@/lib/db";
import type { AuthUser } from "@/features/access/types";
import { monthKeyOfEntry } from "@/features/hr/lib/hr-period";
import type { BankDebit } from "@/features/treasury/lib/circulation";
import type { HrLite } from "@/features/treasury/lib/duplicates";
import { requireTreasury } from "@/features/treasury/services/treasury-access";
import { ok, type ActionResult } from "@/types";
import { toIsoDate } from "@/utils/dates";

/** Décimal SQL → nombre au centime (valeur absente : 0). */
function dec(value: { toNumber(): number } | null | undefined): number {
  return value ? Math.round(value.toNumber() * 100) / 100 : 0;
}

/**
 * Écritures RH et débits du relevé utiles à l'anti-doublon et aux suggestions (lecture seule).
 * Les données sont confidentielles : l'accès Trésorerie de l'appelant est revérifié ici, la fonction n'est jamais appelable sans acteur.
 */
export async function loadDuplicateSources(actor: AuthUser): Promise<ActionResult<{ hr: HrLite[]; debits: BankDebit[] }>> {
  const guard = requireTreasury(actor, "view");
  if (!guard.success) return guard;
  const [hrRows, lines] = await Promise.all([
    db.hrEntry.findMany({ where: { sens: "PAIEMENT" }, select: { id: true, nature: true, mois: true, annee: true, date: true, montant: true, libelle: true, beneficiaire: true } }),
    db.bankStatementLine.findMany({ where: { sens: "DEBIT" }, select: { date: true, libelle: true, numero: true, montant: true } }),
  ]);
  return ok({
    hr: hrRows.map((row) => {
      const date = toIsoDate(row.date);
      return { id: row.id, nature: row.nature, monthKey: monthKeyOfEntry({ nature: row.nature, mois: row.mois, annee: row.annee, date }), date, montant: dec(row.montant), libelle: row.libelle, beneficiaire: row.beneficiaire };
    }),
    debits: lines.map((line) => ({ date: toIsoDate(line.date) ?? "", libelle: line.libelle, numero: line.numero, montant: dec(line.montant) })),
  });
}
