import { describe, expect, it } from "vitest";
import type { Activity } from "@/features/invoices/lib/activity";
import { aggregateProviders, visibleProviders, type ProviderContribution } from "@/features/invoices/lib/provider-activity";

function unpaid(activity: Activity, tiers: string, montant: number, reste = montant, oldestDays = 10): ProviderContribution {
  return { activity, tiers, invoiced: montant, paid: Math.round((montant - reste) * 100) / 100, due: reste, pending: 1, oldestDays, lastPaid: null };
}
function paid(activity: Activity, tiers: string, montant: number, lastPaid: string): ProviderContribution {
  return { activity, tiers, invoiced: montant, paid: montant, due: 0, pending: 0, oldestDays: 0, lastPaid };
}

const entries: ProviderContribution[] = [
  unpaid("assistance", "Garage A", 100000.1),
  unpaid("assistance", "Garage A", 50000.2, 20000.05, 40),
  paid("assistance", "Garage A", 30000, "2026-03-01"),
  unpaid("bdg", "Garage A", 12345.67),
  unpaid("bdg", "Vitres B", 80000.33),
  paid("bdg", "Vitres C", 5000, "2026-02-10"),
  unpaid("autre", "Cabinet TVA", 777.77),
  paid("autre", "Cabinet TVA", 100, "2026-01-05"),
];

describe("aggregateProviders", () => {
  const result = aggregateProviders(entries);

  it("la somme des trois activités égale le total global (montants et factures)", () => {
    const { assistance, bdg, autre } = result.activities;
    expect(Math.round((assistance.due + bdg.due + autre.due) * 100) / 100).toBe(result.due);
    expect(assistance.pending + bdg.pending + autre.pending).toBe(result.pending);
    expect(result.due).toBe(Math.round((100000.1 + 20000.05 + 12345.67 + 80000.33 + 777.77) * 100) / 100);
    expect(result.pending).toBe(5);
  });

  it("le total global par prestataire est celui d'avant, toutes activités confondues", () => {
    const garage = result.items.find((item) => item.tiers === "Garage A");
    expect(garage?.pending).toBe(3);
    expect(garage?.due).toBe(Math.round((100000.1 + 20000.05 + 12345.67) * 100) / 100);
    expect(garage?.lastPaid).toBe("2026-03-01");
    expect(garage?.oldestDays).toBe(40);
  });

  it("un prestataire peut figurer dans deux activités, avec des soldes séparés", () => {
    const inAssistance = result.activities.assistance.items.find((item) => item.tiers === "Garage A");
    const inBdg = result.activities.bdg.items.find((item) => item.tiers === "Garage A");
    expect(inAssistance?.due).toBe(120000.15);
    expect(inAssistance?.pending).toBe(2);
    expect(inBdg?.due).toBe(12345.67);
    expect(inBdg?.pending).toBe(1);
    expect(inBdg?.lastPaid).toBeNull();
  });

  it("totaux d'activité : reste à payer, factures impayées, prestataires en attente", () => {
    expect(result.activities.assistance).toMatchObject({ due: 120000.15, pending: 2, providers: 1 });
    expect(result.activities.bdg).toMatchObject({ due: 92346, pending: 2, providers: 2 });
    expect(result.activities.autre).toMatchObject({ due: 777.77, pending: 1, providers: 1 });
  });

  it("trie par reste à payer décroissant", () => {
    expect(result.activities.bdg.items.map((item) => item.tiers)).toEqual(["Vitres B", "Garage A", "Vitres C"]);
  });

  it("sans contribution : trois activités vides", () => {
    const empty = aggregateProviders([]);
    expect(empty.due).toBe(0);
    for (const group of Object.values(empty.activities)) expect(group).toMatchObject({ items: [], due: 0, pending: 0, providers: 0 });
  });
});

describe("visibleProviders", () => {
  const items = aggregateProviders(entries).activities.bdg.items;

  it("masque les soldés par défaut", () => {
    expect(visibleProviders(items, false).map((item) => item.tiers)).toEqual(["Vitres B", "Garage A"]);
  });

  it("les affiche avec l'interrupteur", () => {
    expect(visibleProviders(items, true)).toHaveLength(3);
  });

  it("ne modifie pas la liste d'origine", () => {
    const before = items.length;
    visibleProviders(items, true).pop();
    expect(items).toHaveLength(before);
  });
});
