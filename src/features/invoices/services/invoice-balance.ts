import type { Invoice } from "@/generated/prisma/client";
import { decimalToNumber } from "@/features/invoices/services/invoice-mapper";
import { readExtra, type InvoiceExtra, type PartialPayment } from "@/features/invoices/services/invoice-extra";
import { round2 } from "@/utils/amounts";
import { toIsoDate } from "@/utils/dates";

/** Partie d'une facture réglée par un paiement : toute la facture, les débours seuls ou les frais seuls. */
export type PaymentPart = "tout" | "debours" | "frais";

/** Vue « règlement » d'une facture, utilisée par le rapprochement et les demandes de paiement. */
export interface PayableInvoice {
  id: string;
  legacyId: string;
  sens: "CREDIT" | "DEBIT";
  status: "EN_ATTENTE" | "REGLE" | "ANNULE";
  categorie: string;
  tiers: string;
  numero: string;
  libelle: string;
  montant: number;
  montantGlobal: number | null;
  debours: number;
  frais: number;
  dateFacture: string | null;
  dateOperation: string | null;
  cheque: string;
  succursale: string;
  payroll: boolean;
  origine: string;
  paymentRefs: string[];
  extra: InvoiceExtra;
}

/** Convertit une ligne Prisma en vue de règlement. */
export function toPayable(row: Invoice): PayableInvoice {
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
    debours: decimalToNumber(row.debours) ?? 0,
    frais: decimalToNumber(row.frais) ?? 0,
    dateFacture: toIsoDate(row.dateFacture),
    dateOperation: toIsoDate(row.dateOperation),
    cheque: row.cheque,
    succursale: row.succursale,
    payroll: row.payroll,
    origine: row.origine,
    paymentRefs: row.paymentRefs,
    extra: readExtra(row.extra),
  };
}

/** La facture se règle en deux parties (débours et frais de gestion) ? */
export function isSplit(invoice: Pick<PayableInvoice, "debours" | "frais">): boolean {
  return invoice.debours > 0 || invoice.frais > 0;
}

/** Total des paiements partiels déjà reçus. */
export function paidSum(invoice: Pick<PayableInvoice, "extra">): number {
  return round2((invoice.extra.paiements ?? []).reduce((sum, payment) => sum + payment.montant, 0));
}

/** Reste à régler (0 si la facture n'est pas en attente). */
export function remaining(invoice: PayableInvoice): number {
  if (invoice.status !== "EN_ATTENTE") return 0;
  if (isSplit(invoice)) {
    return round2((invoice.extra.regDebours ? 0 : invoice.debours) + (invoice.extra.regFrais ? 0 : invoice.frais));
  }
  return Math.max(0, round2(invoice.montant - paidSum(invoice)));
}

/** Option de règlement : une partie de facture et le montant attendu. */
export interface PaymentOption {
  invoice: PayableInvoice;
  part: PaymentPart;
  amount: number;
}

/** Parties encore réglables d'une facture (règle de l'ancienne version). `used` contient « id:partie ». */
export function paymentOptions(invoice: PayableInvoice, used: ReadonlySet<string>): PaymentOption[] {
  const free = (part: PaymentPart): boolean => !used.has(`${invoice.id}:${part}`) && !used.has(`${invoice.id}:tout`);
  const options: PaymentOption[] = [];
  if (isSplit(invoice)) {
    const rest = remaining(invoice);
    if (rest > 0 && free("tout") && !used.has(`${invoice.id}:debours`) && !used.has(`${invoice.id}:frais`)) options.push({ invoice, part: "tout", amount: rest });
    if (invoice.debours > 0 && !invoice.extra.regDebours && free("debours")) options.push({ invoice, part: "debours", amount: invoice.debours });
    if (invoice.frais > 0 && !invoice.extra.regFrais && free("frais")) options.push({ invoice, part: "frais", amount: invoice.frais });
  } else if (free("tout")) {
    options.push({ invoice, part: "tout", amount: remaining(invoice) || invoice.montant });
  }
  return options.filter((option) => option.amount > 0);
}

/** Moyen de paiement appliqué lors d'un règlement. */
export interface PaymentInfo {
  date: string;
  mode: "VIREMENT" | "CHEQUE" | "VERSEMENT" | "AUTRE" | null;
  numero: string;
  banque?: string;
}

/** Résultat d'un règlement : nouvel état, champs modifiés et `extra` mis à jour. */
export interface SettlementChange {
  status: "EN_ATTENTE" | "REGLE";
  dateOperation: string | null;
  mode: PaymentInfo["mode"];
  cheque: string;
  banque: string | null;
  extra: InvoiceExtra;
}

/**
 * Applique un règlement (toute la facture ou une partie) — reprise fidèle de `applyPart` :
 * pour une facture BDG, chaque partie est datée ; la facture n'est soldée que quand les deux le sont.
 * Un paiement partiel sur une facture simple qui a déjà des acomptes est ajouté à la liste des paiements.
 */
export function settle(invoice: PayableInvoice, part: PaymentPart, payment: PaymentInfo, amount?: number): SettlementChange {
  const extra: InvoiceExtra = { ...invoice.extra };
  const info = { type: payment.mode ?? "", numero: payment.numero, date: payment.date };
  let cheque = invoice.cheque;
  if (payment.mode === "CHEQUE") cheque = payment.numero || cheque;
  else if (payment.numero) extra.refPaiement = payment.numero;
  if (part === "debours") {
    extra.regDebours = payment.date;
    extra.payDebours = info;
  } else if (part === "frais") {
    extra.regFrais = payment.date;
    extra.payFrais = info;
  } else if (isSplit(invoice)) {
    if (invoice.debours > 0 && !invoice.extra.regDebours) {
      extra.regDebours = payment.date;
      extra.payDebours = info;
    }
    if (invoice.frais > 0 && !invoice.extra.regFrais) {
      extra.regFrais = payment.date;
      extra.payFrais = info;
    }
  }
  const splitDone = (!(invoice.debours > 0) || Boolean(extra.regDebours)) && (!(invoice.frais > 0) || Boolean(extra.regFrais));
  let done = isSplit(invoice) ? splitDone : true;
  if (!isSplit(invoice) && amount !== undefined) {
    const already = paidSum(invoice);
    if ((extra.paiements ?? []).length > 0 || round2(already + amount) < invoice.montant - 0.5) {
      const list: PartialPayment[] = [...(extra.paiements ?? []), { date: payment.date, montant: amount, type: payment.mode ?? "", numero: payment.numero }];
      extra.paiements = list;
      if (payment.mode === "CHEQUE" && payment.numero && invoice.cheque && !invoice.cheque.includes(payment.numero)) cheque = `${invoice.cheque} / ${payment.numero}`;
      done = round2(already + amount) >= invoice.montant - 0.5;
    }
  }
  return {
    status: done ? "REGLE" : "EN_ATTENTE",
    dateOperation: done ? payment.date : invoice.dateOperation,
    mode: payment.mode,
    cheque,
    banque: payment.banque || null,
    extra,
  };
}
