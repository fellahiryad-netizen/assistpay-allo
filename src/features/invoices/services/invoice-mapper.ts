import type { Invoice } from "@/generated/prisma/client";
import type { InvoiceDTO } from "@/features/invoices/types";
import { toIsoDate } from "@/utils/dates";

type DecimalLike = { toNumber(): number };

/** Décimal SQL → nombre (les montants restent sous 10^12, sans perte au centime). */
export function decimalToNumber(value: DecimalLike): number;
export function decimalToNumber(value: DecimalLike | null): number | null;
export function decimalToNumber(value: DecimalLike | null): number | null {
  return value === null ? null : Math.round(value.toNumber() * 100) / 100;
}

/** Convertit une ligne Prisma en objet transmissible à l'interface. */
export function toInvoiceDTO(row: Invoice): InvoiceDTO {
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
    periode: row.periode,
    debours: decimalToNumber(row.debours),
    frais: decimalToNumber(row.frais),
    origine: row.origine,
    archived: row.archived,
    payroll: row.payroll,
    updatedAt: row.updatedAt.toISOString(),
  };
}
