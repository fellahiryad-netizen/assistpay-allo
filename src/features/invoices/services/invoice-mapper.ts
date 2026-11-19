import type { Invoice } from "@/generated/prisma/client";
import type { InvoiceDTO } from "@/features/invoices/types";
import { branchLabel } from "@/features/invoices/services/branch";
import { activityOf, explicitActivityOf, type ActivityHints } from "@/features/invoices/lib/activity";
import { authorOf, readExtra } from "@/features/invoices/services/invoice-extra";
import { toIsoDate } from "@/utils/dates";

type DecimalLike = { toNumber(): number };

/** Décimal SQL → nombre (les montants restent sous 10^12, sans perte au centime). */
export function decimalToNumber(value: DecimalLike): number;
export function decimalToNumber(value: DecimalLike | null): number | null;
export function decimalToNumber(value: DecimalLike | null): number | null {
  return value === null ? null : Math.round(value.toNumber() * 100) / 100;
}

/** Convertit une ligne Prisma en objet transmissible à l'interface. */
export function toInvoiceDTO(row: Invoice, hints?: ActivityHints): InvoiceDTO {
  const extra = readExtra(row.extra);
  const acomptes = (extra.paiements ?? []).reduce((sum, payment) => sum + payment.montant, 0);
  return {
    id: row.id,
    legacyId: row.legacyId,
    sens: row.sens,
    status: row.status,
    categorie: row.categorie,
    tiers: row.tiers,
    numero: row.numero,
    libelle: row.libelle,
    montant: decimalToNumber(row.montant),
    montantGlobal: decimalToNumber(row.montantGlobal),
    dateOperation: toIsoDate(row.dateOperation),
    dateFacture: toIsoDate(row.dateFacture),
    annee: row.annee,
    mode: row.mode,
    cheque: row.cheque,
    banque: row.banque,
    nature: row.nature,
    classe: row.classe,
    succursale: row.succursale,
    succursaleNom: branchLabel(row),
    periode: row.periode,
    debours: decimalToNumber(row.debours),
    frais: decimalToNumber(row.frais),
    origine: row.origine,
    activite: row.sens === "DEBIT" ? activityOf({ categorie: row.categorie, extra: row.extra, nature: row.nature, tiers: row.tiers, libelle: row.libelle }, hints) : null,
    activiteExplicite: row.sens === "DEBIT" && explicitActivityOf(row.extra) !== null,
    par: authorOf(extra),
    partiel: row.status === "EN_ATTENTE" && acomptes > 0,
    archived: row.archived,
    payroll: row.payroll,
    updatedAt: row.updatedAt.toISOString(),
  };
}
