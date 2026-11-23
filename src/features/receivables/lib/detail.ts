import { branchLabel, branchOf } from "@/features/invoices/services/branch";
import { AGING_BUCKETS } from "@/features/receivables/lib/aging";
import { ACTIVITY_LABELS, classifyCategorie, type ReceivableActivity } from "@/features/receivables/lib/company";
import { sharesPercent } from "@/features/receivables/lib/percent";
import { toReceivableLine } from "@/features/receivables/lib/aggregate";
import type { DetailBranch, DetailInput, DetailInvoice, DetailLine, DetailScope, ReceivableDetail, ReminderRef } from "@/features/receivables/types";
import { upperPlain } from "@/utils/text";

/** Seuils d'ancienneté proposés pour les relances (jours). */
export const DETAIL_AGE_FILTERS: ReadonlyArray<30 | 60 | 90> = [30, 60, 90];

/** Libellé d'une succursale dont le nom n'a pas pu être déterminé. */
export const UNKNOWN_BRANCH = "Non précisée";

const ACTIVITY_CODES: Readonly<Record<string, ReceivableActivity>> = { ASSISTANCE: "ASSISTANCE", BDG: "BDG", AUTRE: "AUTRE" };

/** Texte d'URL d'un périmètre : « CAAT » ou « CAAT:BDG ». */
export function scopeKey(scope: DetailScope): string {
  return scope.activity ? `${scope.company}:${scope.activity}` : scope.company;
}

/** Lit `?detail=CAAT:BDG` ; `null` si vide ou invalide. La compagnie est normalisée comme `companyOf`. */
export function parseScope(raw: string | null | undefined): DetailScope | null {
  const text = (raw ?? "").trim();
  if (!text) return null;
  const cut = text.lastIndexOf(":");
  const code = cut >= 0 ? ACTIVITY_CODES[upperPlain(text.slice(cut + 1)).trim()] : undefined;
  const name = cut >= 0 && code ? text.slice(0, cut) : text;
  const company = classifyCategorie(name).company;
  if (!company || company.length > 80) return null;
  return { company, activity: code ?? null };
}

/** Libellé lisible d'un périmètre : « CAAT · BDG ». */
export function scopeLabel(scope: DetailScope): string {
  return scope.activity ? `${scope.company} · ${ACTIVITY_LABELS[scope.activity]}` : scope.company;
}

/** Enrichit une facture pour le détail : succursale lisible (`branchLabel`) et clé de succursale (`branchOf`, comme la fiche partenaire). */
export function toDetailLine(input: DetailInput, today: string): DetailLine {
  const base = toReceivableLine(input, today);
  const source = { categorie: input.categorie, succursale: input.succursale, tiers: input.tiers, libelle: input.libelle };
  return { ...base, tiers: input.tiers, periode: input.periode, partner: input.partner, branch: branchLabel(source) || UNKNOWN_BRANCH, branchKey: branchOf(source) };
}

/** La facture appartient-elle au périmètre ? */
export function inScope(line: { company: string; activity: ReceivableActivity }, scope: DetailScope): boolean {
  return line.company === scope.company && (scope.activity === null || line.activity === scope.activity);
}

/**
 * Factures à relancer : plus de `minAge` jours, ou sans date (même règle que la lettre de relance des partenaires).
 * Sans seuil, toutes les factures sont gardées.
 */
export function passesAgeFilter(ageDays: number | null, minAge: number | null): boolean {
  return minAge === null || ageDays === null || ageDays > minAge;
}

function latestDate(values: ReadonlyArray<string | null>): string | null {
  let best: string | null = null;
  for (const value of values) if (value && (best === null || value > best)) best = value;
  return best;
}

/** Dernière relance d'une facture : la plus récente relance qui la cite, sinon celle de sa succursale (ou du partenaire entier). */
export function lastReminderOf(reminders: readonly ReminderRef[], line: { id: string; partner: string; branchKey: string }): string | null {
  const dates = reminders
    .filter((reminder) => reminder.partenaire === line.partner)
    .filter((reminder) => reminder.factures.includes(line.id) || reminder.succursale === "" || (line.branchKey !== "" && reminder.succursale === line.branchKey))
    .map((reminder) => reminder.sentAt.slice(0, 10));
  return latestDate(dates);
}

/**
 * Détail d'un périmètre : factures regroupées par succursale (tri par montant décroissant), sous-totaux, parts en %,
 * ancienneté, dernière relance. Montants additionnés en centimes ; sans filtre d'ancienneté, le total du panneau
 * est exactement le montant du périmètre.
 */
export function buildDetail(lines: readonly DetailLine[], scope: DetailScope, minAge: number | null, reminders: readonly ReminderRef[] = []): ReceivableDetail {
  const inside = lines.filter((line) => inScope(line, scope));
  const scopeCents = inside.reduce((sum, line) => sum + Math.round(line.montant * 100), 0);
  const shown = inside.filter((line) => passesAgeFilter(line.ageDays, minAge));
  const groups = new Map<string, DetailLine[]>();
  for (const line of shown) groups.set(line.branch, [...(groups.get(line.branch) ?? []), line]);
  const cents = (items: readonly DetailLine[]): number => items.reduce((sum, line) => sum + Math.round(line.montant * 100), 0);
  const ordered = [...groups.entries()].sort((a, b) => cents(b[1]) - cents(a[1]) || a[0].localeCompare(b[0], "fr"));
  const shares = sharesPercent(ordered.map(([, items]) => cents(items) / 100));
  const branches: DetailBranch[] = ordered.map(([label, items], index) => {
    const invoices: DetailInvoice[] = [...items]
      .sort((a, b) => Math.round(b.montant * 100) - Math.round(a.montant * 100) || a.numero.localeCompare(b.numero, "fr"))
      .map((line) => ({
        id: line.id,
        numero: line.numero,
        libelle: line.libelle,
        periode: line.periode,
        date: line.dateFacture ?? line.dateOperation,
        ageDays: line.ageDays,
        aging: line.aging,
        amount: line.montant,
        partner: line.partner,
        lastReminder: lastReminderOf(reminders, line),
      }));
    const dated = items.filter((line) => line.ageDays !== null);
    const oldest = dated.reduce<DetailLine | null>((best, line) => (best === null || (line.ageDays ?? 0) > (best.ageDays ?? 0) ? line : best), null);
    return {
      label,
      branchKey: items.find((line) => line.branchKey !== "")?.branchKey ?? "",
      amount: cents(items) / 100,
      count: items.length,
      share: shares[index] ?? 0,
      oldestDays: oldest?.ageDays ?? null,
      oldestDate: oldest ? (oldest.dateFacture ?? oldest.dateOperation) : null,
      lastReminder: latestDate(invoices.map((invoice) => invoice.lastReminder)),
      partners: [...new Set(items.map((line) => line.partner).filter((partner) => partner !== ""))],
      invoices,
    };
  });
  return { scope, scopeTotal: scopeCents / 100, scopeCount: inside.length, minAge, total: cents(shown) / 100, count: shown.length, branches };
}

/** Libellé de tranche d'une clé d'ancienneté (« 31 – 60 j »). */
export function agingLabelOf(key: string): string {
  return AGING_BUCKETS.find((bucket) => bucket.key === key)?.label ?? key;
}
