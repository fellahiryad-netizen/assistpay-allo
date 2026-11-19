import { ACTIVITIES, type Activity } from "@/features/invoices/lib/activity";
import { round2 } from "@/utils/amounts";

/** Solde d'un prestataire (factures fournisseurs). */
export interface ProviderBalance {
  tiers: string;
  invoiced: number;
  paid: number;
  due: number;
  pending: number;
  oldestDays: number;
  lastPaid: string | null;
}

/** Ce qu'une facture fournisseur apporte au solde de son prestataire (montants déjà calculés par `toPayable` / `remaining`). */
export interface ProviderContribution {
  activity: Activity;
  tiers: string;
  invoiced: number;
  paid: number;
  due: number;
  /** 1 si la facture n'est pas réglée, sinon 0. */
  pending: number;
  oldestDays: number;
  lastPaid: string | null;
}

/** Prestataires d'une activité, avec leurs totaux. */
export interface ActivityGroup {
  activity: Activity;
  items: ProviderBalance[];
  /** Reste à payer de l'activité. */
  due: number;
  /** Nombre de factures impayées. */
  pending: number;
  /** Nombre de prestataires qui ont un reste à payer. */
  providers: number;
}

/** Résultat de l'agrégation : vue globale par prestataire (comme avant) et vue par activité. */
export interface ProviderAggregation {
  items: ProviderBalance[];
  due: number;
  pending: number;
  activities: Record<Activity, ActivityGroup>;
}

function sortBalances(items: ProviderBalance[]): ProviderBalance[] {
  return items.sort((a, b) => b.due - a.due || b.invoiced - a.invoiced);
}

function accumulate(map: Map<string, ProviderBalance>, entry: ProviderContribution): void {
  const balance = map.get(entry.tiers) ?? { tiers: entry.tiers, invoiced: 0, paid: 0, due: 0, pending: 0, oldestDays: 0, lastPaid: null };
  balance.invoiced = round2(balance.invoiced + entry.invoiced);
  balance.paid = round2(balance.paid + entry.paid);
  balance.due = round2(balance.due + entry.due);
  balance.pending += entry.pending;
  balance.oldestDays = Math.max(balance.oldestDays, entry.oldestDays);
  if (entry.lastPaid && (!balance.lastPaid || entry.lastPaid > balance.lastPaid)) balance.lastPaid = entry.lastPaid;
  map.set(entry.tiers, balance);
}

/**
 * Regroupe les contributions des factures : par prestataire (toutes activités, comme la page l'a toujours fait)
 * et par (activité, prestataire) : un même prestataire peut figurer dans deux activités.
 * Aucun montant n'est recalculé ici : la somme des trois activités égale toujours le total global.
 */
export function aggregateProviders(entries: readonly ProviderContribution[]): ProviderAggregation {
  const global = new Map<string, ProviderBalance>();
  const perActivity = new Map<Activity, Map<string, ProviderBalance>>(ACTIVITIES.map((activity) => [activity, new Map<string, ProviderBalance>()]));
  for (const entry of entries) {
    accumulate(global, entry);
    const target = perActivity.get(entry.activity);
    if (target) accumulate(target, entry);
  }
  const group = (activity: Activity): ActivityGroup => {
    const items = sortBalances([...(perActivity.get(activity)?.values() ?? [])]);
    return {
      activity,
      items,
      due: round2(items.reduce((sum, item) => sum + item.due, 0)),
      pending: items.reduce((sum, item) => sum + item.pending, 0),
      providers: items.filter((item) => item.due > 0).length,
    };
  };
  const items = sortBalances([...global.values()]);
  return {
    items,
    due: round2(items.reduce((sum, item) => sum + item.due, 0)),
    pending: items.reduce((sum, item) => sum + item.pending, 0),
    activities: { assistance: group("assistance"), bdg: group("bdg"), autre: group("autre") },
  };
}

/** Prestataires à afficher : par défaut seulement ceux qui ont un reste à payer ; `showSettled` ajoute les soldés. */
export function visibleProviders(items: readonly ProviderBalance[], showSettled: boolean): ProviderBalance[] {
  return showSettled ? [...items] : items.filter((item) => item.due > 0);
}
