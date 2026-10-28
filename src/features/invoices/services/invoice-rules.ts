import { can } from "@/features/access/services/access-rules";
import type { AuthUser, ModuleKey } from "@/features/access/types";
import type { SensKey } from "@/features/invoices/types";
import { normalizeText } from "@/utils/text";

/** Onglet du tableau des accès qui gouverne chaque sens de facture. */
export function moduleForSens(sens: SensKey): ModuleKey {
  return sens === "CREDIT" ? "FCLI" : "FFOUR";
}

/** Une ligne est « de paie » (salaires, CNAS, G50, IRG) : réservée à l'accès RH. */
export function isPayrollInvoice(categorie: string, nature: string): boolean {
  const text = ` ${normalizeText(`${categorie} ${nature}`).toUpperCase()} `;
  return /PERSONNEL|SALAIRE|CNAS|[^A-Z0-9]G50[^A-Z0-9]|[^A-Z0-9]IRG[^A-Z0-9]/.test(text);
}

/** Sens que l'utilisateur peut consulter. */
export function visibleSens(user: AuthUser): SensKey[] {
  const result: SensKey[] = [];
  if (can(user, "FCLI")) result.push("CREDIT");
  if (can(user, "FFOUR")) result.push("DEBIT");
  return result;
}

/** L'utilisateur peut-il consulter / modifier cette facture ? */
export function canOnInvoice(user: AuthUser, invoice: { sens: SensKey; payroll: boolean }, level: "VIEW" | "EDIT"): boolean {
  if (invoice.payroll && !can(user, "RH", level)) return false;
  return can(user, moduleForSens(invoice.sens), level);
}

/** Année comptable d'une facture : année de la date de facture, sinon de la date d'opération. */
export function invoiceYear(dateFacture: string | null, dateOperation: string | null): number | null {
  const source = dateFacture ?? dateOperation;
  return source ? Number(source.slice(0, 4)) : null;
}
