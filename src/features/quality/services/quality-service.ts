import { db } from "@/lib/db";
import { can, requireAccess } from "@/features/access/services/access-rules";
import type { AuthUser } from "@/features/access/types";
import { isSplit, remaining, toPayable, type PayableInvoice } from "@/features/invoices/services/invoice-balance";
import { countDoubleEntryWork } from "@/features/statement/services/double-entry-service";
import { ok, type ActionResult } from "@/types";
import { round2 } from "@/utils/amounts";
import { toIsoDate, todayIso } from "@/utils/dates";
import { alnumKey } from "@/utils/text";

/** Ligne signalée par le contrôle qualité. */
export interface QualityInvoice {
  id: string;
  sens: "CREDIT" | "DEBIT";
  categorie: string;
  tiers: string;
  numero: string;
  libelle: string;
  montant: number;
  reste: number;
  dateFacture: string | null;
  dateOperation: string | null;
  status: string;
}

/** Règle de contrôle qualité et ses lignes. */
export interface QualityRule {
  key: string;
  title: string;
  hint: string;
  count: number;
  /** Lien vers l'écran qui traite ce point (au lieu de la liste). */
  href?: string;
  items: QualityInvoice[];
}

const isPersonnel = (invoice: PayableInvoice): boolean => /charges de personnel/i.test(invoice.categorie);
const yearOf = (invoice: PayableInvoice): number => Number((invoice.dateFacture ?? invoice.dateOperation ?? "0").slice(0, 4));
const isBdg = (invoice: PayableInvoice): boolean => invoice.sens === "CREDIT" && /BDG/i.test(`${invoice.categorie} ${invoice.libelle}`);

/** Écart de paiement ouvert (trop-perçu ou manque accepté, non régularisé). */
export function openGap(invoice: PayableInvoice): number {
  const gap = Number(invoice.extra.ecart ?? 0);
  return gap && !invoice.extra.ecartRegle ? gap : 0;
}

/**
 * Contrôle qualité des factures (repris de l'ancienne version) : dates manquantes ou impossibles, n° manquants,
 * lignes sans catégorie, BDG sans répartition, paiements partiels, écarts de paiement, doublons probables, double emploi.
 */
export async function qualityReport(actor: AuthUser): Promise<ActionResult<{ rules: QualityRule[]; total: number }>> {
  const guard = requireAccess(actor, "QC");
  if (!guard.success) return guard;
  const showPayroll = can(actor, "RH");
  const sens = [...(can(actor, "FCLI") ? (["CREDIT"] as const) : []), ...(can(actor, "FFOUR") ? (["DEBIT"] as const) : [])];
  const rows = await db.invoice.findMany({ where: { sens: { in: sens }, archived: false, ...(showPayroll ? {} : { payroll: false }) } });
  const invoices = rows.map(toPayable);
  const maxYear = Number(todayIso().slice(0, 4)) + 1;
  const badDate = (date: string | null): boolean => Boolean(date) && (Number(date?.slice(0, 4)) < 2020 || Number(date?.slice(0, 4)) > maxYear);
  const byNumber = new Map<string, PayableInvoice[]>();
  for (const invoice of invoices) {
    const key = alnumKey(invoice.numero);
    if (key.length < 3) continue;
    const id = `${invoice.sens}|${key}|${invoice.montant.toFixed(2)}`;
    byNumber.set(id, [...(byNumber.get(id) ?? []), invoice]);
  }
  const duplicates = new Set([...byNumber.values()].filter((list) => list.length > 1).flatMap((list) => list.map((invoice) => invoice.id)));
  const isCaatAdvance = (i: PayableInvoice): boolean => i.sens === "CREDIT" && /caat/i.test(i.categorie) && (Boolean(i.extra.avance) || /avance/i.test(i.libelle));
  const definitions: Array<{ key: string; title: string; hint: string; test: (invoice: PayableInvoice) => boolean }> = [
    { key: "nodate", title: "Factures en attente sans date de dépôt", hint: "Sans cette date, l'ancienneté et la prévision d'encaissement ne peuvent pas être calculées.", test: (i) => i.status === "EN_ATTENTE" && !i.dateFacture && !isPersonnel(i) && !isCaatAdvance(i) },
    { key: "nodatecaat", title: "Avances CAAT en attente sans date de dépôt", hint: "Factures d'avance CAAT (90 %), classées à part pour suivre leur montant et les déposer à la succursale.", test: (i) => i.status === "EN_ATTENTE" && !i.dateFacture && isCaatAdvance(i) },
    { key: "nonum", title: "Factures partenaires en attente sans n° de facture", hint: "Le n° de facture aide à retrouver les paiements dans le relevé.", test: (i) => i.sens === "CREDIT" && !i.numero && !i.extra.avance && i.status === "EN_ATTENTE" && !isPersonnel(i) },
    { key: "nocat", title: "Lignes sans partenaire / catégorie", hint: "Elles n'apparaissent dans aucune fiche partenaire.", test: (i) => !i.categorie && i.status !== "ANNULE" && yearOf(i) >= 2025 },
    { key: "dates", title: "Dates impossibles", hint: `Année hors 2020–${maxYear}, ou règlement avant la facture.`, test: (i) => badDate(i.dateOperation) || badDate(i.dateFacture) || Boolean(i.dateOperation && i.dateFacture && i.dateOperation < i.dateFacture) },
    { key: "bdg", title: "Factures BDG sans répartition débours / frais", hint: "Sans répartition, un paiement séparé des débours ou des frais n'est pas reconnu.", test: (i) => isBdg(i) && !isSplit(i) && i.status === "EN_ATTENTE" },
    { key: "partiel", title: "Paiements partiels non soldés", hint: "Honoraires payés en partie : vérifiez le reste à encaisser.", test: (i) => i.status === "EN_ATTENTE" && (i.extra.paiements?.length ?? 0) > 0 },
    { key: "ecart", title: "Écarts de paiement à régulariser", hint: "Trop-perçus ou paiements inférieurs acceptés : à régulariser avec le partenaire (avoir, déduction sur la prochaine facture…).", test: (i) => openGap(i) !== 0 },
    { key: "dbl", title: "Doublons probables", hint: "Même n° de facture, même montant et même sens, saisis deux fois.", test: (i) => duplicates.has(i.id) },
  ];
  const toItem = (invoice: PayableInvoice): QualityInvoice => ({
    id: invoice.id,
    sens: invoice.sens,
    categorie: invoice.categorie,
    tiers: invoice.tiers,
    numero: invoice.numero,
    libelle: invoice.libelle,
    montant: invoice.montant,
    reste: remaining(invoice),
    dateFacture: invoice.dateFacture,
    dateOperation: invoice.dateOperation,
    status: invoice.status,
  });
  const rules: QualityRule[] = definitions.map((definition) => {
    const matched = invoices.filter(definition.test).sort((a, b) => (a.dateFacture ?? a.dateOperation ?? "").localeCompare(b.dateFacture ?? b.dateOperation ?? ""));
    return { key: definition.key, title: definition.title, hint: definition.hint, count: matched.length, items: matched.slice(0, 200).map(toItem) };
  });
  rules.push(...(await bankRules(actor, invoices, toItem)));
  const doubleWork = await countDoubleEntryWork(actor);
  rules.splice(7, 0, { key: "dblglob", title: "Double emploi global / détail (Débit) et virements à rapprocher", hint: "Virement global de prestataires saisi en plus des lignes de chaque prestataire, ou global saisi deux fois.", count: doubleWork, href: "/releve/rapprochement", items: [] });
  return ok({ rules, total: rules.reduce((sum, rule) => sum + rule.count, 0) });
}


/**
 * Contrôles croisés facture / relevé bancaire (encaissements de 2026) : montant du virement différent des factures reliées,
 * facture reliée à plusieurs virements, avance CAAT réglée à 0 DA, répartition débours + frais différente du total.
 */
async function bankRules(actor: AuthUser, invoices: PayableInvoice[], toItem: (invoice: PayableInvoice) => QualityInvoice): Promise<QualityRule[]> {
  const byLegacy = new Map(invoices.map((invoice) => [invoice.legacyId, invoice]));
  const note = (invoice: PayableInvoice, text: string): QualityInvoice => ({ ...toItem(invoice), libelle: `${invoice.libelle} — ${text}` });
  const rules: QualityRule[] = [];
  if (can(actor, "RELEVE")) {
    const lines = await db.bankStatementLine.findMany({ where: { sens: "CREDIT", status: { in: ["RAPPROCHE", "DEJA"] }, date: { gte: new Date("2026-01-01") } }, orderBy: { date: "desc" } });
    const mismatch = new Map<string, QualityInvoice>();
    const usage = new Map<string, string[]>();
    for (const line of lines) {
      const date = toIsoDate(line.date) ?? "";
      const amount = Number(line.montant);
      let expected = 0;
      let comparable = true;
      const linked: PayableInvoice[] = [];
      for (const ref of line.invoiceRefs) {
        const [legacyId = "", part = "tout"] = ref.split(":");
        usage.set(legacyId, [...(usage.get(legacyId) ?? []), `${date} ${amount.toFixed(2)} DA`]);
        const invoice = byLegacy.get(legacyId);
        if (!invoice) {
          comparable = false;
          continue;
        }
        linked.push(invoice);
        if ((invoice.extra.paiements?.length ?? 0) > 0) comparable = false;
        expected += part === "debours" ? invoice.debours : part === "frais" ? invoice.frais : invoice.montant;
      }
      if (!comparable || linked.length === 0) continue;
      const gap = round2(amount - expected);
      if (Math.abs(gap) > 0.5) for (const invoice of linked) mismatch.set(`${line.id}|${invoice.id}`, note(invoice, `virement du ${date} : ${amount.toFixed(2)} DA reçu, ${expected.toFixed(2)} DA attendu (écart ${gap.toFixed(2)} DA)`));
    }
    const mismatchItems = [...mismatch.values()];
    rules.push({ key: "bankgap", title: "Virement du relevé différent des factures reliées", hint: "Le montant reçu ne correspond pas à la somme des factures (ou parts débours / frais) affectées : affectation probablement erronée. Détachez-la dans le relevé.", count: mismatchItems.length, items: mismatchItems.slice(0, 200) });
    const multi = [...usage.entries()].filter(([, list]) => list.length > 1).flatMap(([legacyId, list]) => {
      const invoice = byLegacy.get(legacyId);
      return invoice ? [note(invoice, `reliée à ${list.length} virements : ${list.join(" ; ")}`)] : [];
    });
    rules.push({ key: "banktwice", title: "Facture reliée à plusieurs virements", hint: "Une même facture (ou avance) apparaît dans plusieurs lignes du relevé : double affectation à vérifier.", count: multi.length, items: multi.slice(0, 200) });
  }
  const zero = invoices.filter((invoice) => invoice.sens === "CREDIT" && invoice.extra.avance && invoice.status === "REGLE" && invoice.montant <= 0);
  rules.push({ key: "advzero", title: "Avance CAAT réglée à 0 DA", hint: "Avance marquée réglée sans montant : le virement n'a pas été correctement affecté.", count: zero.length, items: zero.slice(0, 200).map((invoice) => toItem(invoice)) });
  const sums = invoices.filter((invoice) => isSplit(invoice) && Math.abs(round2(invoice.debours + invoice.frais - invoice.montant)) > 0.5 && invoice.status !== "ANNULE");
  rules.push({ key: "splitsum", title: "Débours + frais différents du montant de la facture", hint: "Le total n'égale pas la somme des deux parts : corrigez le débours, les frais ou le total.", count: sums.length, items: sums.slice(0, 200).map((invoice) => note(invoice, `débours ${invoice.debours.toFixed(2)} + frais ${invoice.frais.toFixed(2)} = ${round2(invoice.debours + invoice.frais).toFixed(2)} DA, total saisi ${invoice.montant.toFixed(2)} DA`)) });
  return rules;
}
