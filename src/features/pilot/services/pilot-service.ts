import { db } from "@/lib/db";
import { can, requireAccess } from "@/features/access/services/access-rules";
import type { AuthUser } from "@/features/access/types";
import { remaining, toPayable, type PayableInvoice } from "@/features/invoices/services/invoice-balance";
import { partnerKey } from "@/features/partners/services/partner-service";
import { CAAR_BRANCHES } from "@/features/caar/schemas";
import { openGap, qualityReport } from "@/features/quality/services/quality-service";
import { getControlSettings } from "@/features/settings/services/settings-service";
import { AGING_BUCKETS, type ActivityMargin, type AgingRow, type ClosingItem, type TreasuryForecast } from "@/features/pilot/types";
import { ok, type ActionResult } from "@/types";
import { round2 } from "@/utils/amounts";
import { MONTHS_FR, daysBetween, shiftIsoDate, toIsoDate, todayIso } from "@/utils/dates";
import { formatDA, formatDate } from "@/utils/format";
import { alnumKey, upperPlain } from "@/utils/text";

async function visibleInvoices(actor: AuthUser): Promise<PayableInvoice[]> {
  const rows = await db.invoice.findMany({ where: { archived: false, ...(can(actor, "RH") ? {} : { payroll: false }) } });
  return rows.map(toPayable);
}

const monthOf = (date: string | null): string => (date ?? "").slice(0, 7);

/** Délai réel de paiement par partenaire : moyenne pondérée par les montants, sur les 13 derniers mois. */
export function paymentDelays(invoices: PayableInvoice[]): Map<string, number> {
  const limit = shiftIsoDate(todayIso(), -400);
  const acc = new Map<string, { w: number; s: number }>();
  for (const invoice of invoices) {
    if (invoice.sens !== "CREDIT" || invoice.status !== "REGLE" || !invoice.dateOperation || !invoice.dateFacture || invoice.dateOperation < limit) continue;
    const days = daysBetween(invoice.dateFacture, invoice.dateOperation);
    if (days < 0 || days > 720) continue;
    const key = partnerKey(invoice.categorie);
    const entry = acc.get(key) ?? { w: 0, s: 0 };
    entry.w += invoice.montant;
    entry.s += days * invoice.montant;
    acc.set(key, entry);
  }
  return new Map([...acc.entries()].filter(([, entry]) => entry.w > 0).map(([key, entry]) => [key, Math.round(entry.s / entry.w)]));
}

/** Liste de clôture d'un mois (AAAA-MM) : relevé, rapprochement, CAAR, honoraires, virements, RIB, RH, écarts, doublons, qualité. */
export async function closingChecklist(actor: AuthUser, ym: string): Promise<ActionResult<ClosingItem[]>> {
  const guard = requireAccess(actor, "PILOT");
  if (!guard.success) return guard;
  const [year, month] = ym.split("-").map(Number) as [number, number];
  const label = `${MONTHS_FR[month - 1] ?? month} ${year}`;
  const end = shiftIsoDate(`${month === 12 ? year + 1 : year}-${String(month === 12 ? 1 : month + 1).padStart(2, "0")}-01`, -1);
  const [invoices, lastLine, todo, productions, batches, ribsToCheck, hr, quality, settings, debits] = await Promise.all([
    visibleInvoices(actor),
    db.bankStatementLine.findFirst({ orderBy: { date: "desc" }, select: { date: true } }),
    db.bankStatementLine.findMany({ where: { status: "A_TRAITER", date: { gte: new Date(`${ym}-01T00:00:00Z`), lte: new Date(`${end}T00:00:00Z`) } }, select: { montant: true } }),
    db.caarProduction.findMany({ where: { annee: year, mois: month } }),
    db.transferBatch.findMany({ where: { annee: year, mois: MONTHS_FR[month - 1] ?? "", status: { not: "rejete" } } }),
    db.providerRib.count({ where: { status: "a_valider" } }),
    can(actor, "RH") ? db.hrEntry.findMany({ where: { mois: ym, sens: "PAIEMENT" }, select: { montant: true } }) : Promise.resolve(null),
    qualityReport(actor),
    getControlSettings(),
    db.bankStatementLine.findMany({ where: { sens: "DEBIT" }, select: { montant: true } }),
  ]);
  const items: ClosingItem[] = [];
  const last = toIsoDate(lastLine?.date ?? null);
  items.push({ state: last && last >= end ? "ok" : "err", title: `Relevé bancaire importé jusqu'au ${formatDate(end)}`, detail: last ? `Dernière opération importée : ${formatDate(last)}.` : "Aucun relevé importé.", href: "/releve" });
  const todoTotal = round2(todo.reduce((sum, line) => sum + Number(line.montant), 0));
  items.push({ state: todo.length ? "err" : "ok", title: "Opérations du relevé rapprochées", detail: todo.length ? `${todo.length} opération(s) de ${label} encore à traiter (${formatDA(todoTotal)}).` : "Toutes les opérations du mois sont rapprochées.", href: "/releve?onglet=a-traiter" });
  const billed = productions.filter((production) => production.status === "facture");
  const missing = CAAR_BRANCHES.filter((branch) => !billed.some((production) => production.succursale === branch));
  items.push({
    state: billed.length === CAAR_BRANCHES.length ? "ok" : billed.length ? "warn" : "err",
    title: `Factures CAAR des ${CAAR_BRANCHES.length} succursales`,
    detail: `${billed.length}/${CAAR_BRANCHES.length} facturées · ${productions.length}/${CAAR_BRANCHES.length} fichiers de production contrôlés${missing.length ? ` · manquantes : ${missing.join(", ")}` : ""}.`,
    href: "/caar",
  });
  const monthWord = upperPlain(MONTHS_FR[month - 1] ?? "").slice(0, 4);
  for (const partner of ["GAM", "TRUST", "MLA"]) {
    const found = invoices.some((invoice) => {
      if (invoice.sens !== "CREDIT" || partnerKey(invoice.categorie) !== partner) return false;
      const text = upperPlain(invoice.libelle).replace(/\s+/g, "");
      return text.includes(monthWord) && (text.includes(String(year)) || monthOf(invoice.dateFacture) >= ym);
    });
    items.push({ state: found ? "ok" : "warn", title: `Honoraire ${partner} de ${label}`, detail: found ? "Facture trouvée au Crédit." : "Aucune facture repérée pour ce mois (vérifiez le libellé ou établissez-la).", href: "/facturation/nouvelle" });
  }
  const pendingBatches = batches.filter((batch) => batch.status === "attente");
  const debitAmounts = debits.map((line) => Number(line.montant));
  const onStatement = batches.filter((batch) => debitAmounts.some((amount) => Math.abs(amount - Number(batch.debit)) < 0.01));
  items.push({
    state: batches.length ? (pendingBatches.length ? "warn" : "ok") : "warn",
    title: "Virements prestataires du mois",
    detail: batches.length
      ? `${batches.length} envoi(s) · ${formatDA(batches.reduce((sum, batch) => sum + Number(batch.credit), 0))} · ${onStatement.length}/${batches.length} débités sur le relevé${pendingBatches.length ? ` · ${pendingBatches.length} en attente de validation` : ""}.`
      : "Aucun envoi enregistré pour ce mois.",
    href: "/virements",
  });
  items.push({ state: ribsToCheck ? "err" : "ok", title: "Changements de RIB", detail: ribsToCheck ? `${ribsToCheck} RIB à valider ou supprimer.` : "Aucun changement de RIB en attente.", href: "/virements?onglet=rib&filtre=a_valider" });
  if (hr) items.push({ state: hr.length ? "ok" : "warn", title: "Charges de personnel du mois (RH)", detail: hr.length ? `Total RH saisi : ${formatDA(hr.reduce((sum, entry) => sum + Number(entry.montant), 0))}.` : "Aucune charge de personnel saisie pour ce mois.", href: `/rh?mois=${ym}` });
  const gaps = invoices.filter((invoice) => openGap(invoice) !== 0);
  items.push({ state: gaps.length ? "err" : "ok", title: "Écarts de paiement à régulariser", detail: gaps.length ? `${gaps.length} écart(s) ouvert(s) : ${gaps.slice(0, 4).map((invoice) => `${invoice.categorie} ${invoice.numero}`.trim()).join(", ")}.` : "Aucun écart ouvert.", href: "/controle?regle=ecart" });
  const numbers = new Map<string, PayableInvoice[]>();
  for (const invoice of invoices) {
    if (invoice.sens !== "CREDIT" || !invoice.numero || Number((invoice.dateFacture ?? invoice.dateOperation ?? "").slice(0, 4)) !== year) continue;
    const key = `${alnumKey(invoice.numero)}|${partnerKey(invoice.categorie)}|${/DEBOUR/i.test(invoice.libelle) ? "D" : ""}`;
    numbers.set(key, [...(numbers.get(key) ?? []), invoice]);
  }
  const duplicated = [...numbers.values()].filter((list) => list.length > 1);
  items.push({
    state: duplicated.length ? "err" : "ok",
    title: `N° de facture en double (${year})`,
    detail: duplicated.length ? duplicated.slice(0, 6).map((list) => `${list[0]?.numero ?? ""} ×${list.length} (${list.map((invoice) => formatDA(invoice.montant)).join(" / ")})`).join(" · ") : "Aucun numéro en double.",
    href: "/controle?regle=dbl",
  });
  const qc = quality.success ? quality.data.total : 0;
  items.push({ state: qc ? "warn" : "ok", title: "Contrôle qualité", detail: qc ? `${qc} point(s) signalé(s) par le contrôle qualité.` : "Aucun point signalé.", href: "/controle" });
  items.push({
    state: settings.articleImposition ? "ok" : "warn",
    title: "Mentions légales des factures",
    detail: settings.articleImposition ? `Article d'imposition renseigné : ${settings.articleImposition}.` : "Le n° d'article d'imposition d'Allo Assistance n'est pas renseigné : complétez-le dans l'onglet « Paramètres et sauvegarde ».",
    href: "/pilotage?onglet=parametres",
  });
  return ok(items);
}

/** Balance âgée des créances clients par partenaire, avec le délai réel de paiement. */
export async function agingBalance(actor: AuthUser): Promise<ActionResult<{ rows: AgingRow[]; total: AgingRow }>> {
  const guard = requireAccess(actor, "PILOT");
  if (!guard.success) return guard;
  const invoices = await visibleInvoices(actor);
  const delays = paymentDelays(invoices);
  const today = todayIso();
  const by = new Map<string, AgingRow>();
  for (const invoice of invoices) {
    if (invoice.sens !== "CREDIT" || invoice.status !== "EN_ATTENTE") continue;
    const rest = remaining(invoice);
    if (!(rest > 0)) continue;
    const key = partnerKey(invoice.categorie);
    const row = by.get(key) ?? { partner: key, count: 0, buckets: AGING_BUCKETS.map(() => 0), undated: 0, total: 0, dso: delays.get(key) ?? null };
    if (invoice.dateFacture) {
      const days = Math.max(0, daysBetween(invoice.dateFacture, today));
      const index = AGING_BUCKETS.findIndex(([, min, max]) => days >= min && days <= max);
      row.buckets[index >= 0 ? index : 0] = round2((row.buckets[index >= 0 ? index : 0] ?? 0) + rest);
    } else row.undated = round2(row.undated + rest);
    row.total = round2(row.total + rest);
    row.count += 1;
    by.set(key, row);
  }
  const rows = [...by.values()].sort((a, b) => b.total - a.total);
  const total: AgingRow = {
    partner: "Total",
    count: rows.reduce((sum, row) => sum + row.count, 0),
    buckets: AGING_BUCKETS.map((_, index) => round2(rows.reduce((sum, row) => sum + (row.buckets[index] ?? 0), 0))),
    undated: round2(rows.reduce((sum, row) => sum + row.undated, 0)),
    total: round2(rows.reduce((sum, row) => sum + row.total, 0)),
    dso: null,
  };
  return ok({ rows, total });
}

const isProvider = (invoice: PayableInvoice): boolean => /PRESTATAIRE/.test(upperPlain(invoice.categorie));
const isPayroll = (invoice: PayableInvoice): boolean => invoice.payroll || /PERSONNEL/.test(upperPlain(invoice.categorie));

/** Prévision de trésorerie à 90 jours (flux net : le solde bancaire de départ n'est pas suivi). */
export async function treasuryForecast(actor: AuthUser): Promise<ActionResult<TreasuryForecast>> {
  const guard = requireAccess(actor, "PILOT");
  if (!guard.success) return guard;
  const invoices = await visibleInvoices(actor);
  const delays = paymentDelays(invoices);
  const today = todayIso();
  const inflows = [0, 0, 0, 0];
  const bucket = (date: string): number => {
    const days = daysBetween(today, date);
    return days <= 0 ? 0 : days <= 30 ? 1 : days <= 60 ? 2 : days <= 90 ? 3 : -1;
  };
  for (const invoice of invoices) {
    if (invoice.sens !== "CREDIT" || invoice.status !== "EN_ATTENTE") continue;
    const rest = remaining(invoice);
    if (!(rest > 0)) continue;
    const expected = shiftIsoDate(invoice.dateFacture ?? today, delays.get(partnerKey(invoice.categorie)) ?? 60);
    const index = bucket(expected);
    if (index >= 0) inflows[index] = round2((inflows[index] ?? 0) + rest);
  }
  const monthSet = [1, 2, 3].map((back) => {
    const index = Number(today.slice(0, 4)) * 12 + Number(today.slice(5, 7)) - 1 - back;
    return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
  });
  const average = (test: (invoice: PayableInvoice) => boolean): number => round2(invoices.filter((invoice) => invoice.sens === "DEBIT" && invoice.status === "REGLE" && monthSet.includes(monthOf(invoice.dateOperation)) && test(invoice)).reduce((sum, invoice) => sum + invoice.montant, 0) / 3);
  const avgProviders = average(isProvider);
  const avgPayroll = average(isPayroll);
  const avgOthers = average((invoice) => !isProvider(invoice) && !isPayroll(invoice));
  const providers = [0, avgProviders, avgProviders, avgProviders];
  const payroll = [0, avgPayroll, avgPayroll, avgPayroll];
  const others = [0, avgOthers, avgOthers, avgOthers];
  for (const invoice of invoices) {
    if (invoice.sens !== "DEBIT" || invoice.status !== "EN_ATTENTE") continue;
    const rest = remaining(invoice) || invoice.montant;
    const target = isProvider(invoice) ? providers : isPayroll(invoice) ? payroll : others;
    target[0] = round2((target[0] ?? 0) + rest);
  }
  const outflows = [0, 1, 2, 3].map((index) => round2((providers[index] ?? 0) + (payroll[index] ?? 0) + (others[index] ?? 0)));
  const net = [0, 1, 2, 3].map((index) => round2((inflows[index] ?? 0) - (outflows[index] ?? 0)));
  let running = 0;
  const cumulative = net.map((value) => (running = round2(running + value)));
  return ok({ inflows, providers, payroll, others, outflows, net, cumulative, averages: { providers: avgProviders, payroll: avgPayroll, others: avgOthers, months: monthSet.map((m) => `${MONTHS_FR[Number(m.slice(5)) - 1] ?? m} ${m.slice(0, 4)}`) } });
}

/** Rentabilité indicative par activité (production facturée – coût prestataires payé), mois par mois. */
export async function activityMargins(actor: AuthUser, year: number): Promise<ActionResult<ActivityMargin[]>> {
  const guard = requireAccess(actor, "PILOT");
  if (!guard.success) return guard;
  const [invoices, natures] = await Promise.all([visibleInvoices(actor), db.invoice.findMany({ where: { sens: "CREDIT" }, select: { id: true, nature: true } })]);
  const natureById = new Map(natures.map((row) => [row.id, upperPlain(row.nature)]));
  const cat = (invoice: PayableInvoice): string => upperPlain(invoice.categorie);
  const nature = (invoice: PayableInvoice): string => natureById.get(invoice.id) ?? "";
  const activities: Array<{ key: string; label: string; prod: (i: PayableInvoice) => boolean; cost: (i: PayableInvoice) => boolean }> = [
    { key: "A", label: "Assistance routière", prod: (i) => i.sens === "CREDIT" && /ASSISTANCE|REFACTURATION/.test(nature(i)), cost: (i) => i.sens === "DEBIT" && /PRESTATAIRE ASSISTANCE/.test(cat(i)) },
    { key: "B", label: "Bris de glace (BDG)", prod: (i) => i.sens === "CREDIT" && /BDG/.test(`${cat(i)} ${nature(i)}`), cost: (i) => i.sens === "DEBIT" && /PRESTATAIRE BDG|PRESTATAIRES TVA/.test(cat(i)) },
    { key: "T", label: "Tiers payant", prod: (i) => i.sens === "CREDIT" && /TIERS PAYANT/.test(nature(i)), cost: (i) => i.sens === "DEBIT" && /PRESTATAIRE TPA/.test(cat(i)) },
  ];
  const months = Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, "0")}`);
  const result: ActivityMargin[] = [];
  for (const activity of activities) {
    const production = months.map((m) => round2(invoices.filter((i) => activity.prod(i) && i.status !== "ANNULE" && monthOf(i.dateFacture ?? i.dateOperation) === m).reduce((sum, i) => sum + i.montant, 0)));
    const cost = months.map((m) => round2(invoices.filter((i) => activity.cost(i) && i.status === "REGLE" && monthOf(i.dateOperation ?? i.dateFacture) === m).reduce((sum, i) => sum + i.montant, 0)));
    const totalProduction = round2(production.reduce((sum, value) => sum + value, 0));
    const totalCost = round2(cost.reduce((sum, value) => sum + value, 0));
    if (totalProduction || totalCost) result.push({ key: activity.key, label: activity.label, production, cost, totalProduction, totalCost });
  }
  return ok(result);
}
