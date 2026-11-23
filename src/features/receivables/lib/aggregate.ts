import { AGING_BUCKETS, ageInDays, agingKeyOf, type AgingKey } from "@/features/receivables/lib/aging";
import { classifyCategorie, companySlug, type ReceivableActivity } from "@/features/receivables/lib/company";
import { sharesPercent } from "@/features/receivables/lib/percent";
import type { ActivityFilter, AmountCount, AttentionItem, CompanyRow, ReceivableInput, ReceivableLine, ReceivablesSummary } from "@/features/receivables/types";

const ACTIVITIES: readonly ReceivableActivity[] = ["ASSISTANCE", "BDG", "AUTRE"];

/** Cumul en centimes (évite toute dérive des flottants). */
interface Cents {
  cents: number;
  count: number;
}

function emptyActivities(): Record<ReceivableActivity, Cents> {
  return { ASSISTANCE: { cents: 0, count: 0 }, BDG: { cents: 0, count: 0 }, AUTRE: { cents: 0, count: 0 } };
}

function emptyAging(): Record<AgingKey, Cents> {
  return { D0_30: { cents: 0, count: 0 }, D31_60: { cents: 0, count: 0 }, D61_90: { cents: 0, count: 0 }, D90_PLUS: { cents: 0, count: 0 }, SANS_DATE: { cents: 0, count: 0 } };
}

function toAmount(value: Cents): AmountCount {
  return { amount: value.cents / 100, count: value.count };
}

function toAmounts<K extends string>(record: Record<K, Cents>): Record<K, AmountCount> {
  const keys = Object.keys(record) as K[];
  return Object.fromEntries(keys.map((key) => [key, toAmount(record[key])])) as Record<K, AmountCount>;
}

/** Enrichit une facture en attente : compagnie, activité, ancienneté et tranche. */
export function toReceivableLine(input: ReceivableInput, today: string): ReceivableLine {
  const { company, activity } = classifyCategorie(input.categorie);
  const ageDays = ageInDays(input.dateFacture, input.dateOperation, today);
  return { ...input, company, activity, ageDays, aging: agingKeyOf(ageDays) };
}

/** Garde les factures de l'activité demandée (`null` : toutes). */
export function filterByActivity<T extends ReceivableLine>(lines: readonly T[], activity: ActivityFilter): T[] {
  return activity ? lines.filter((line) => line.activity === activity) : [...lines];
}

interface CompanyAcc {
  company: string;
  total: Cents;
  byActivity: Record<ReceivableActivity, Cents>;
  aging: Record<AgingKey, Cents>;
  oldest: ReceivableLine | null;
  categories: Set<string>;
}

/**
 * Analyse des créances : regroupement par compagnie, ventilations par activité et par tranche d'ancienneté,
 * parts en %, ancienneté moyenne pondérée et points d'attention.
 * Les montants sont additionnés en centimes ; les parts (somme 100,0) sont calculées au plus fort reste.
 */
export function buildReceivables(lines: readonly ReceivableLine[], today: string): ReceivablesSummary {
  const accs = new Map<string, CompanyAcc>();
  const activities = emptyActivities();
  const aging = emptyAging();
  let totalCents = 0;
  let weighted = 0;
  let weightBase = 0;
  for (const line of lines) {
    const cents = Math.round(line.montant * 100);
    const acc = accs.get(line.company) ?? { company: line.company, total: { cents: 0, count: 0 }, byActivity: emptyActivities(), aging: emptyAging(), oldest: null, categories: new Set<string>() };
    acc.total.cents += cents;
    acc.total.count += 1;
    acc.byActivity[line.activity].cents += cents;
    acc.byActivity[line.activity].count += 1;
    acc.aging[line.aging].cents += cents;
    acc.aging[line.aging].count += 1;
    if (line.ageDays !== null && (acc.oldest === null || line.ageDays > (acc.oldest.ageDays ?? -1))) acc.oldest = line;
    const raw = line.categorie.trim();
    if (raw) acc.categories.add(raw);
    accs.set(line.company, acc);
    activities[line.activity].cents += cents;
    activities[line.activity].count += 1;
    aging[line.aging].cents += cents;
    aging[line.aging].count += 1;
    totalCents += cents;
    if (line.ageDays !== null && cents > 0) {
      weighted += cents * line.ageDays;
      weightBase += cents;
    }
  }
  const ordered = [...accs.values()].sort((a, b) => b.total.cents - a.total.cents || a.company.localeCompare(b.company, "fr"));
  const shares = sharesPercent(ordered.map((acc) => acc.total.cents / 100));
  const companies: CompanyRow[] = ordered.map((acc, index) => ({
    company: acc.company,
    slug: companySlug(acc.company),
    amount: acc.total.cents / 100,
    share: shares[index] ?? 0,
    count: acc.total.count,
    oldestDays: acc.oldest?.ageDays ?? null,
    oldestDate: acc.oldest ? (acc.oldest.dateFacture ?? acc.oldest.dateOperation) : null,
    oldestNumero: acc.oldest?.numero ?? "",
    byActivity: toAmounts(acc.byActivity),
    aging: toAmounts(acc.aging),
    categories: [...acc.categories].sort((a, b) => a.localeCompare(b, "fr")),
  }));
  const attentionOf = (key: AgingKey): AttentionItem[] =>
    companies.filter((row) => row.aging[key].count > 0).map((row) => ({ company: row.company, count: row.aging[key].count, amount: row.aging[key].amount })).sort((a, b) => b.amount - a.amount);
  const top = companies[0];
  return {
    asOf: today,
    total: totalCents / 100,
    count: lines.length,
    companies,
    byActivity: toAmounts(activities),
    aging: toAmounts(aging),
    weightedAgeDays: weightBase > 0 ? Math.round((weighted / weightBase) * 10) / 10 : null,
    undated: toAmount(aging.SANS_DATE),
    mostExposed: top ? { company: top.company, share: top.share, amount: top.amount } : null,
    attention: { over90: attentionOf("D90_PLUS"), undated: attentionOf("SANS_DATE") },
  };
}

/** Clés des activités, dans l'ordre d'affichage. */
export const ACTIVITY_KEYS: readonly ReceivableActivity[] = ACTIVITIES;

/** Clés des tranches, dans l'ordre d'affichage. */
export const AGING_KEYS: readonly AgingKey[] = AGING_BUCKETS.map((bucket) => bucket.key);
