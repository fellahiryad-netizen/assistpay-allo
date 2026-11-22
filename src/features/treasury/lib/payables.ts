import { round2 } from "@/utils/amounts";
import { daysBetween } from "@/utils/dates";
import { upperPlain } from "@/utils/text";
import type { SimLine, SimType } from "@/features/treasury/types";

/** Nature d'un paiement à venir. */
export type PayNature = "assistance" | "bdg" | "fiscal" | "social" | "salaire" | "autre";

/** Libellés des natures. */
export const NATURE_LABELS: Readonly<Record<PayNature, string>> = {
  assistance: "Prestataires assistance routière",
  bdg: "Prestataires BDG",
  fiscal: "Fiscal (G50, IRG / IBS)",
  social: "Social (CNAS)",
  salaire: "Salaires",
  autre: "Autres",
};

/** Ordre d'affichage des natures. */
export const NATURE_ORDER: readonly PayNature[] = ["assistance", "bdg", "fiscal", "social", "salaire", "autre"];

/**
 * Nature d'une facture fournisseur selon sa catégorie : « Prestataire assistance routière » et variantes → assistance ;
 * « Prestataire BDG » et variantes (bris de glace) → BDG ; tout le reste → autres fournisseurs. Règle locale simple.
 */
export function invoiceNature(categorie: string): "assistance" | "bdg" | "autre" {
  const text = upperPlain(categorie);
  if (!/PRESTATAIRE/.test(text)) return "autre";
  if (/\bBDG\b|BRIS|GLACE/.test(text)) return "bdg";
  if (/ASSIST|ROUTI|DEPANN|REMORQ/.test(text)) return "assistance";
  return "autre";
}

/** Nature d'une ligne de simulation. */
export function simNature(type: SimType): PayNature {
  switch (type) {
    case "G50":
    case "IRG_IBS":
      return "fiscal";
    case "CNAS":
      return "social";
    case "SALAIRES":
      return "salaire";
    default:
      return "autre";
  }
}

/** Source d'un paiement à venir. */
export type PaySource = "facture" | "simulation" | "demande";

/** Paiement à venir (ligne de l'échéancier). */
export interface PayableItem {
  id: string;
  /** Date prévue `AAAA-MM-JJ` (date du solde pour une facture dont l'échéance n'est pas fixée). */
  date: string;
  beneficiaire: string;
  libelle: string;
  nature: PayNature;
  montant: number;
  source: PaySource;
  /** Simulation : montant certain ou estimation. */
  certain: boolean;
  /** Ancienneté de la facture en jours, ou null. */
  ageDays: number | null;
}

/** Facture fournisseur en attente, réduite aux champs utiles. */
export interface PendingInvoiceInput {
  id: string;
  numero: string;
  tiers: string;
  categorie: string;
  libelle: string;
  dateFacture: string | null;
  /** Reste à payer (fonction `remaining` de invoice-balance.ts). */
  remaining: number;
}

/** Transforme les factures en attente en paiements à venir (les restes nuls sont écartés). */
export function invoiceItems(invoices: readonly PendingInvoiceInput[], date: string, today: string): PayableItem[] {
  return invoices
    .filter((invoice) => invoice.remaining > 0)
    .map((invoice) => ({
      id: `facture:${invoice.id}`,
      date,
      beneficiaire: invoice.tiers || invoice.libelle || "—",
      libelle: [invoice.numero, invoice.libelle].filter(Boolean).join(" — "),
      nature: invoiceNature(invoice.categorie),
      montant: round2(invoice.remaining),
      source: "facture" as const,
      certain: true,
      ageDays: invoice.dateFacture ? Math.max(0, daysBetween(invoice.dateFacture, today)) : null,
    }));
}

/** Transforme les lignes de simulation comptées en paiements à venir. Les lignes ignorées (« ne pas compter ») sont écartées. */
export function simulationItems(lines: readonly SimLine[], balanceDate: string): PayableItem[] {
  return lines
    .filter((line) => line.decision !== "ignorer")
    .map((line) => ({
      id: `simulation:${line.id}`,
      date: line.date < balanceDate ? balanceDate : line.date,
      beneficiaire: line.libelle,
      libelle: line.periode ? `${line.libelle} (${line.periode})` : line.libelle,
      nature: simNature(line.type),
      montant: round2(line.montant),
      source: "simulation" as const,
      certain: line.certitude === "CERTAIN",
      ageDays: null,
    }));
}

/** Demande de paiement sans facture liée, comptée seulement si la case est cochée. */
export interface RequestInput {
  id: string;
  ref: string;
  beneficiaire: string;
  montant: number;
}

/** Transforme des demandes de paiement sans facture liée en paiements à venir (à confirmer). */
export function requestItems(requests: readonly RequestInput[], date: string): PayableItem[] {
  return requests
    .filter((request) => request.montant > 0)
    .map((request) => ({ id: `demande:${request.id}`, date, beneficiaire: request.beneficiaire || "—", libelle: request.ref ? `Demande ${request.ref}` : "Demande de paiement", nature: "autre" as const, montant: round2(request.montant), source: "demande" as const, certain: false, ageDays: null }));
}

/** Total des montants. */
export function sumAmounts(items: ReadonlyArray<{ montant: number }>): number {
  return round2(items.reduce((sum, item) => sum + item.montant, 0));
}

/** Totaux par nature (les natures vides sont omises), dans l'ordre d'affichage. */
export function totalsByNature(items: readonly PayableItem[]): Array<{ nature: PayNature; label: string; count: number; total: number }> {
  return NATURE_ORDER.map((nature) => {
    const list = items.filter((item) => item.nature === nature);
    return { nature, label: NATURE_LABELS[nature], count: list.length, total: sumAmounts(list) };
  }).filter((row) => row.count > 0);
}

/** Rang de priorité de paiement : fiscal et social, salaires, prestataires (assistance avant BDG), autres. */
export function priorityRank(nature: PayNature): number {
  switch (nature) {
    case "fiscal":
    case "social":
      return 1;
    case "salaire":
      return 2;
    case "assistance":
      return 3;
    case "bdg":
      return 4;
    default:
      return 5;
  }
}

/** Ordre conseillé de paiement : rang, puis facture la plus ancienne, puis montant décroissant. */
export function priorityOrder(items: readonly PayableItem[]): PayableItem[] {
  return [...items].sort((a, b) => priorityRank(a.nature) - priorityRank(b.nature) || (b.ageDays ?? -1) - (a.ageDays ?? -1) || b.montant - a.montant || a.id.localeCompare(b.id));
}

/** Groupe de l'ordre de priorité conseillé. */
export interface PriorityGroup {
  rank: number;
  label: string;
  count: number;
  total: number;
  /** Ancienneté de la plus ancienne facture du groupe, ou null. */
  oldestDays: number | null;
}

const PRIORITY_LABELS: Readonly<Record<number, string>> = {
  1: "Obligations fiscales et sociales (G50, IRG, CNAS) : pénalités de retard",
  2: "Salaires",
  3: "Prestataires assistance routière, par ancienneté de facture",
  4: "Prestataires BDG, par ancienneté de facture",
  5: "Autres fournisseurs et frais de mission",
};

/** Ordre de priorité de paiement conseillé, résumé par groupe (les groupes vides sont omis). */
export function priorityGroups(items: readonly PayableItem[]): PriorityGroup[] {
  const groups: PriorityGroup[] = [];
  for (const rank of [1, 2, 3, 4, 5]) {
    const list = items.filter((item) => priorityRank(item.nature) === rank);
    if (list.length === 0) continue;
    const ages = list.map((item) => item.ageDays).filter((age): age is number => age !== null);
    groups.push({ rank, label: PRIORITY_LABELS[rank] ?? "", count: list.length, total: sumAmounts(list), oldestDays: ages.length ? Math.max(...ages) : null });
  }
  return groups;
}
