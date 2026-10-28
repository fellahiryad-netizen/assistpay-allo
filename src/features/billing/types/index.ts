import type { BillingRow, BillingTotals, ComputedRow } from "@/features/billing/config";

/** Coordonnées du client imprimées sur la facture. */
export interface BillingClientInfo {
  nom: string;
  adresse: string;
  tel: string;
  rc: string;
  nif: string;
  nis: string;
  ai: string;
}

/** Facture en cours de saisie (ou facture émise, telle qu'enregistrée). */
export interface BillingDraft {
  preset: string;
  client: string;
  cli: BillingClientInfo;
  num: string;
  num2: string;
  date: string;
  objet: string;
  per: string;
  perTxt: string;
  succ: string;
  bc: string;
  origine: string;
  destination: string;
  details: Record<string, string>;
  notes: string;
  rows: BillingRow[];
  bdgType: "pair" | "deb" | "fra";
  caarProd: string;
  fromPrev: string;
  /** Article d'imposition de l'émetteur imprimé sur la facture (paramètre « controle »). */
  emAi?: string;
}

/** Résultat du calcul d'une facture. */
export interface BillingComputation {
  rows: ComputedRow[];
  totals: BillingTotals;
}

/** Facture émise (liste). */
export interface IssuedInvoiceDTO {
  id: string;
  num: string;
  num2: string;
  client: string;
  clientLabel: string;
  date: string | null;
  objet: string;
  presetLabel: string;
  perTxt: string;
  ttc: number;
  invoiceId: string | null;
  invoiceStatus: string | null;
  rectifications: number;
}
