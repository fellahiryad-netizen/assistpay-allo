import { paymentOptions, isSplit, paidSum, type PayableInvoice, type PaymentOption } from "@/features/invoices/services/invoice-balance";
import type { Confidence, ParsedLine, Proposal, ProposalItem, RecordedMatch } from "@/features/statement/types";
import { round2 } from "@/utils/amounts";
import { dayGap } from "@/utils/dates";
import { alnumKey, upperPlain } from "@/utils/text";

/** Payeurs reconnus dans les libellés bancaires → famille de catégories. */
const PAYERS: ReadonlyArray<[string, string]> = [
  ["MAGHREB LEASING", "MLA"],
  ["GENERALE ASSURANCE MED", "GAM"],
  ["ERALE ASSURANCE MED", "GAM"],
  ["GENERALE ASSURANCE", "GAM"],
  ["CAAR", "CAAR"],
  ["COMPAGNIE ALGERIENNE ASSURANCE CA", "CAAR"],
  ["REASSURANCE", "CAAR"],
  ["COMPAGNIE ALGERIENNE DES ASS", "CAAT"],
  ["COMPAGNIE ALGERIENNE D", "CAAT|CAAR"],
  ["CAAT", "CAAT"],
  ["TRUST", "TRUST"],
];

const FAMILIES: Readonly<Record<string, readonly string[]>> = {
  CAAT: ["CAAT", "BDG CAAT", "Frai Gestion BDG", "Frais de gestion BDG"],
  GAM: ["GAM", "GAM BDG", "Honoraire GAM", "Refacturation GAM"],
  MLA: ["MLA"],
  CAAR: ["CAAR"],
  TRUST: ["TRUST", "Trust BDG", "TRUST ASSURANCE"],
};

const TOLERANCE = 0.5;

/** Famille du payeur reconnue dans le libellé, ou `null`. */
export function payerFamily(libelle: string): string | null {
  const text = upperPlain(libelle);
  for (const [pattern, family] of PAYERS) if (text.includes(pattern)) return family;
  return null;
}

/** La facture appartient-elle à la famille du payeur du libellé (vrai si aucun payeur reconnu) ? */
export function inFamily(libelle: string, invoice: Pick<PayableInvoice, "categorie">): boolean {
  const family = payerFamily(libelle);
  if (!family) return true;
  return family.split("|").some((key) => (FAMILIES[key] ?? []).includes(invoice.categorie));
}

/** Points de ressemblance entre un libellé bancaire et une facture (succursale, numéros, tiers). */
export function matchScore(libelle: string, invoice: PayableInvoice, part: ProposalItem["part"]): number {
  const text = upperPlain(libelle);
  const compact = text.replace(/[^A-Z0-9]/g, "");
  let score = 0;
  if (invoice.succursale) {
    const branch = upperPlain(invoice.succursale).replace(/^SUCCURSALE\s*/, "");
    if (branch && text.includes(branch)) score += 4;
  }
  const debours = alnumKey(invoice.extra.factureDebours ?? "");
  const frais = alnumKey(invoice.extra.factureFrais ?? "");
  if (debours.length >= 4 && compact.includes(debours)) score += part === "debours" || part === "tout" ? 6 : 2;
  if (frais.length >= 4 && compact.includes(frais)) score += part === "frais" || part === "tout" ? 6 : 2;
  for (const word of upperPlain(`${invoice.tiers} ${invoice.categorie}`).split(/[^A-Z0-9]+/)) if (word.length >= 3 && text.includes(word)) score += 2;
  const numero = alnumKey(invoice.numero);
  if (numero.length >= 4 && compact.includes(numero)) score += 5;
  return score;
}

function itemOf(option: PaymentOption): ProposalItem {
  const partLabel = option.part === "debours" ? " (débours)" : option.part === "frais" ? " (frais de gestion)" : "";
  const label = `${option.invoice.tiers || option.invoice.categorie}${option.invoice.numero ? ` · ${option.invoice.numero}` : ""}${partLabel}`;
  return { invoiceId: option.invoice.id, legacyId: option.invoice.legacyId, part: option.part, amount: option.amount, label };
}

/** Somme de 2 à `maxCount` options égale au montant (± 0,5 DA), en privilégiant les factures les plus anciennes. */
function findCombination(options: PaymentOption[], target: number, maxCount: number): PaymentOption[] | null {
  const pool = options
    .filter((option) => option.amount > 0 && option.amount <= target + TOLERANCE)
    .sort((a, b) => (a.invoice.dateFacture ?? "9").localeCompare(b.invoice.dateFacture ?? "9"))
    .slice(0, 60);
  let steps = 0;
  let best: PaymentOption[] | null = null;
  const pick: PaymentOption[] = [];
  const walk = (start: number, sum: number): void => {
    if (best || ++steps > 300_000) return;
    if (pick.length >= 2 && Math.abs(sum - target) <= TOLERANCE) {
      best = pick.slice();
      return;
    }
    if (pick.length >= maxCount) return;
    for (let index = start; index < pool.length; index += 1) {
      const option = pool[index];
      if (!option) continue;
      const next = sum + option.amount;
      if (next > target + TOLERANCE) continue;
      pick.push(option);
      walk(index + 1, next);
      pick.pop();
      if (best) return;
    }
  };
  walk(0, 0);
  return best;
}

const chequeKey = (value: string): string => {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 5 ? digits.slice(-7) : "";
};

function chequeKeys(invoice: PayableInvoice): Set<string> {
  const keys = new Set<string>();
  for (const payment of invoice.extra.paiements ?? []) if (payment.type === "CHEQUE" && chequeKey(payment.numero)) keys.add(chequeKey(payment.numero));
  for (const part of invoice.cheque.split(/[/&+,;\s]+|(?<=\d)-(?=\d{5,})/)) {
    const key = chequeKey(part);
    if (key) keys.add(key);
  }
  return keys;
}

/**
 * Paiement déjà enregistré dans le suivi ? (facture déjà réglée : même chèque, même groupe de règlement,
 * même montant à moins de 31 jours, ou somme de factures réglées le même jour / à quelques jours).
 */
function findRecorded(line: ParsedLine, recorded: PayableInvoice[], taken: Set<string>): PayableInvoice[] | null {
  const free = recorded.filter((invoice) => invoice.sens === line.sens && !taken.has(invoice.id));
  if (line.type === "CHEQUE" && line.numero) {
    const key = chequeKey(line.numero);
    const compact = alnumKey(line.numero);
    const same = free.filter((invoice) => (invoice.status === "REGLE" || paidSum(invoice) > 0) && (alnumKey(invoice.cheque) === compact || (key !== "" && chequeKeys(invoice).has(key))));
    if (same.length && Math.abs(same.reduce((sum, invoice) => sum + invoice.montant, 0) - line.montant) <= TOLERANCE) return same;
    const group = same.find((invoice) => invoice.extra.groupe && Math.abs(invoice.extra.groupe.montant - line.montant) <= TOLERANCE);
    if (group?.extra.groupe) {
      const groupId = group.extra.groupe.id;
      return same.filter((invoice) => invoice.extra.groupe?.id === groupId);
    }
  }
  const settled = free.filter((invoice) => invoice.status === "REGLE" && invoice.dateOperation);
  const grouped = settled.find(
    (invoice) => invoice.extra.groupe && Math.abs(invoice.extra.groupe.montant - line.montant) <= TOLERANCE && dayGap(invoice.dateOperation ?? line.date, line.date) <= 31,
  );
  if (grouped?.extra.groupe) {
    const groupId = grouped.extra.groupe.id;
    return settled.filter((invoice) => invoice.extra.groupe?.id === groupId);
  }
  const pool = settled.filter((invoice) => inFamily(line.libelle, invoice) && dayGap(invoice.dateOperation ?? line.date, line.date) <= 31);
  const single = pool
    .filter((invoice) => Math.abs(invoice.montant - line.montant) <= TOLERANCE)
    .sort((a, b) => dayGap(a.dateOperation ?? line.date, line.date) - dayGap(b.dateOperation ?? line.date, line.date))[0];
  if (single) return [single];
  const byDay = new Map<string, PayableInvoice[]>();
  for (const invoice of pool) {
    const day = invoice.dateOperation ?? "";
    if (day && dayGap(day, line.date) <= 5) byDay.set(day, [...(byDay.get(day) ?? []), invoice]);
  }
  for (const group of byDay.values()) {
    if (group.length > 1 && Math.abs(group.reduce((sum, invoice) => sum + invoice.montant, 0) - line.montant) <= TOLERANCE) return group;
  }
  const near = pool
    .filter((invoice) => dayGap(invoice.dateOperation ?? line.date, line.date) <= 15)
    .sort((a, b) => dayGap(a.dateOperation ?? line.date, line.date) - dayGap(b.dateOperation ?? line.date, line.date))
    .slice(0, 30);
  for (let i = 0; i < near.length; i += 1) {
    for (let j = i + 1; j < near.length; j += 1) {
      const a = near[i];
      const b = near[j];
      if (!a || !b) continue;
      const pair = a.montant + b.montant;
      if (Math.abs(pair - line.montant) <= TOLERANCE) return [a, b];
      for (let k = j + 1; k < near.length; k += 1) {
        const c = near[k];
        if (c && Math.abs(pair + c.montant - line.montant) <= TOLERANCE) return [a, b, c];
      }
    }
  }
  return null;
}

function confidence(line: ParsedLine, items: PaymentOption[], sure: boolean, transferKnown: boolean): Confidence {
  const score = Math.max(...items.map((item) => matchScore(line.libelle, item.invoice, item.part)));
  const familyOk = Boolean(payerFamily(line.libelle)) && items.every((item) => inFamily(line.libelle, item.invoice));
  if (items.length === 1 && sure && (score >= 2 || familyOk || transferKnown)) return "sur";
  if (score >= 2 || familyOk || transferKnown) return "probable";
  return "verifier";
}

/** Données nécessaires à l'analyse. */
export interface MatchingInput {
  lines: ParsedLine[];
  pending: PayableInvoice[];
  recorded: PayableInvoice[];
  /** Factures déjà liées à une ligne du relevé (identifiants internes). */
  linkedInvoiceIds: Set<string>;
  /** Référence de l'envoi de virements correspondant à un débit, le cas échéant. */
  transferFor: (line: ParsedLine) => string | null;
}

/** Résultat brut de l'analyse. */
export interface MatchingOutput {
  proposals: Proposal[];
  recorded: Array<RecordedMatch & { invoices: PayableInvoice[] }>;
  todo: ParsedLine[];
}

/**
 * Rapprochement automatique — reprise de l'algorithme de l'ancienne version :
 * 1) facture en attente du même montant (ou partie débours / frais), classée par ressemblance du libellé ;
 * 2) sinon somme de 2 à 4 factures d'un même client / fournisseur (virement global) ;
 * 3) sinon paiement déjà enregistré (facture déjà réglée) ;
 * 4) sinon cumul de 2 à 3 virements rapprochés (≤ 5 jours) qui forment une facture ;
 * 5) le reste est « à traiter ».
 */
export function analyseLines(input: MatchingInput): MatchingOutput {
  const used = new Set<string>();
  const taken = new Set(input.linkedInvoiceIds);
  const proposals: Proposal[] = [];
  const recorded: MatchingOutput["recorded"] = [];
  let todo: ParsedLine[] = [];

  for (const line of [...input.lines].sort((a, b) => a.date.localeCompare(b.date))) {
    const candidates = input.pending.filter((invoice) => invoice.sens === line.sens && inFamily(line.libelle, invoice));
    const exact = candidates.flatMap((invoice) => paymentOptions(invoice, used)).filter((option) => Math.abs(option.amount - line.montant) <= TOLERANCE);
    let picked: { items: PaymentOption[]; alternatives: PaymentOption[]; sure: boolean } | null = null;
    if (exact.length) {
      const scored = exact
        .map((option) => ({ option, score: matchScore(line.libelle, option.invoice, option.part) + (option.invoice.dateFacture && option.invoice.dateFacture <= line.date ? 1 : 0) }))
        .sort((a, b) => b.score - a.score || (a.option.invoice.dateFacture ?? "9").localeCompare(b.option.invoice.dateFacture ?? "9"));
      const [first, second] = scored;
      if (first) picked = { items: [first.option], alternatives: scored.slice(1, 6).map((entry) => entry.option), sure: !second || first.score > second.score };
    }
    if (!picked) {
      const groups = new Map<string, PaymentOption[]>();
      const add = (key: string, option: PaymentOption): void => {
        groups.set(key, [...(groups.get(key) ?? []), option]);
      };
      for (const invoice of candidates) {
        const option = paymentOptions(invoice, used).find((entry) => entry.part === "tout");
        if (!option) continue;
        add(`C:${invoice.categorie || "?"}`, option);
        if (invoice.tiers) add(`T:${upperPlain(invoice.tiers)}`, option);
        if (payerFamily(line.libelle)) add("F", option);
      }
      for (const group of groups.values()) {
        if (group.length < 2) continue;
        const combination = findCombination(group, line.montant, 4);
        if (combination) {
          picked = { items: combination, alternatives: [], sure: false };
          break;
        }
      }
    }
    if (picked) {
      for (const option of picked.items) used.add(`${option.invoice.id}:${option.part}`);
      const transferRef = input.transferFor(line);
      proposals.push({
        line,
        items: picked.items.map(itemOf),
        alternatives: picked.alternatives.map(itemOf),
        confidence: confidence(line, picked.items, picked.sure, transferRef !== null),
        transferRef,
      });
      continue;
    }
    const found = findRecorded(line, input.recorded, taken);
    if (found) {
      for (const invoice of found) taken.add(invoice.id);
      recorded.push({ line, labels: found.map((invoice) => `${invoice.tiers || invoice.categorie}${invoice.numero ? ` · ${invoice.numero}` : ""}`), invoices: found });
      continue;
    }
    todo.push(line);
  }

  // Cumul de 2 ou 3 virements du même sens (≤ 5 jours) qui forment ensemble une facture en attente.
  const consumed = new Set<string>();
  const sorted = todo.slice().sort((a, b) => a.date.localeCompare(b.date)).slice(0, 40);
  for (let size = 2; size <= 3; size += 1) {
    const indexes: number[] = [];
    const walk = (start: number): void => {
      if (indexes.length === size) {
        const group = indexes.map((index) => sorted[index]).filter((line): line is ParsedLine => line !== undefined);
        if (group.length !== size || group.some((line) => consumed.has(line.key))) return;
        const sens = group[0]?.sens;
        if (!sens || group.some((line) => line.sens !== sens)) return;
        const dates = group.map((line) => line.date).sort();
        const first = dates[0] ?? "";
        const last = dates[dates.length - 1] ?? "";
        if (dayGap(first, last) > 5) return;
        const total = round2(group.reduce((sum, line) => sum + line.montant, 0));
        const options = input.pending
          .filter((invoice) => invoice.sens === sens)
          .flatMap((invoice) => paymentOptions(invoice, used))
          .filter((option) => Math.abs(option.amount - total) <= 1);
        if (!options.length) return;
        const best = options
          .map((option) => ({ option, score: group.reduce((sum, line) => sum + matchScore(line.libelle, option.invoice, option.part), 0) }))
          .sort((a, b) => b.score - a.score)[0];
        if (!best) return;
        used.add(`${best.option.invoice.id}:${best.option.part}`);
        for (const line of group) consumed.add(line.key);
        for (const line of group) {
          proposals.push({
            line,
            items: [{ ...itemOf(best.option), amount: line.montant, label: `${itemOf(best.option).label} — cumul de ${size} virements (${group.map((entry) => entry.montant.toLocaleString("fr-FR")).join(" + ")})` }],
            alternatives: [],
            confidence: "verifier",
            transferRef: null,
          });
        }
        return;
      }
      for (let index = start; index < sorted.length; index += 1) {
        indexes.push(index);
        walk(index + 1);
        indexes.pop();
      }
    };
    walk(0);
  }
  todo = todo.filter((line) => !consumed.has(line.key));
  return { proposals, recorded, todo };
}

/** Une facture BDG garde-t-elle des parties ouvertes ? (aide à l'affichage) */
export function hasOpenParts(invoice: PayableInvoice): boolean {
  return isSplit(invoice) && (!invoice.extra.regDebours || !invoice.extra.regFrais);
}
