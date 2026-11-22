import { describe, expect, it } from "vitest";
import { chequesInCirculation } from "@/features/treasury/lib/circulation";
import { computeTreasury, type ComputeInput } from "@/features/treasury/lib/compute";
import { buildHypotheses } from "@/features/treasury/lib/hypotheses";
import { minimumExplanation } from "@/features/treasury/lib/minimum";
import { buildVerdict, riskLevel } from "@/features/treasury/lib/risk";
import { DEFAULT_SETTINGS, parseSettings } from "@/features/treasury/lib/store-parse";
import { treasurySettingsSchema } from "@/features/treasury/schemas";
import type { MonthlyFlow, ResolvedBalance, TreasurySettings } from "@/features/treasury/types";

const MIN = 20_000_000;
const base = { cushion: MIN, overdraftDate: null, minimumMode: "montant" as const };

describe("minimum de trésorerie fixe : niveaux de risque (bornes)", () => {
  it("égal au minimum : Vert", () => {
    expect(riskLevel({ ...base, balanceAfter: MIN, lowest: MIN })).toBe("vert");
  });
  it("un centime sous le minimum : Orange", () => {
    expect(riskLevel({ ...base, balanceAfter: 19_999_999.99, lowest: 19_999_999.99 })).toBe("orange");
  });
  it("point bas sous le minimum alors que la fin le dépasse : Orange", () => {
    expect(riskLevel({ ...base, balanceAfter: 50_000_000, lowest: 10_000_000 })).toBe("orange");
  });
  it("zéro exact : Orange ; négatif ou découvert : Rouge", () => {
    expect(riskLevel({ ...base, balanceAfter: 0, lowest: 0 })).toBe("orange");
    expect(riskLevel({ ...base, balanceAfter: -0.01, lowest: -0.01 })).toBe("rouge");
    expect(riskLevel({ ...base, balanceAfter: 30_000_000, lowest: 25_000_000, overdraftDate: "2026-12-01" })).toBe("rouge");
  });
  it("jamais « Indéterminé » avec un minimum fixe, même sans historique de dépenses", () => {
    expect(riskLevel({ ...base, balanceAfter: 90_000_000, lowest: 90_000_000, historyKnown: true })).toBe("vert");
  });
});

describe("phrases du verdict avec un minimum fixe", () => {
  const input = { ...base, perDay: 0, cushionDays: 15, lowestDate: "2026-11-22" };
  it("au-dessus du minimum", () => {
    const verdict = buildVerdict({ ...input, balanceAfter: 41_378_405.18, lowest: 41_378_405.18 });
    expect(verdict.level).toBe("vert");
    expect(verdict.sentence).toMatch(/^Vous pouvez tout payer et il vous resterait 41,4 M DA \(41.378.405,18 DA\)\. C'est au-dessus du minimum de trésorerie fixé à 20,0 M DA \(20.000.000,00 DA\)\.$/);
  });
  it("en dessous du minimum", () => {
    const verdict = buildVerdict({ ...input, balanceAfter: 15_000_000, lowest: 15_000_000 });
    expect(verdict.level).toBe("orange");
    expect(verdict.sentence).toContain("C'est en dessous du minimum de trésorerie fixé à 20,0 M DA");
    expect(verdict.sentence).toMatch(/15,0 M DA \(15.000.000,00 DA\)/);
  });
  it("montant inférieur à 1 M DA : montant exact, jamais « 0,0 M DA »", () => {
    const verdict = buildVerdict({ ...input, balanceAfter: 850_000, lowest: 850_000 });
    expect(verdict.sentence).not.toContain("0,8 M DA");
    expect(verdict.sentence).toMatch(/850.000,00 DA/);
  });
});

const balance: ResolvedBalance = { source: "releve", balance: 120_850_558.05, date: "2026-11-22", lastOperationDate: "2026-11-19", fileName: "r.xls", savedAt: "2026-11-22T09:05:00.000Z", savedBy: "Riad", sourceLabel: "relevé AGB importé" };
const monthly: MonthlyFlow[] = [{ m: "2026-10", credit: 0, debit: 87_000_000 }];

function input(settings: TreasurySettings, remaining: number, history: MonthlyFlow[] = monthly): ComputeInput {
  return {
    today: "2026-11-22",
    balance,
    monthly: history,
    daily: [],
    adjustment: 0,
    cheques: chequesInCirculation([], [], "2026-11-22", "2026-01-04"),
    invoices: [{ id: "f", numero: "F", tiers: "P", categorie: "Prestataire assistance routière", libelle: "", dateFacture: "2026-11-02", remaining }],
    preparedBatches: [],
    requestsWithoutInvoice: [],
    includeRequests: false,
    simulationLines: [],
    settings,
    collections: { rows: [], flows: [], total: 0 },
  };
}

describe("calcul complet avec le minimum de trésorerie", () => {
  it("par défaut le minimum est de 20 000 000,00 DA, indépendant de l'historique", () => {
    const result = computeTreasury(input(DEFAULT_SETTINGS, 56_720_099.87, []));
    expect(result.minimumMode).toBe("montant");
    expect(result.cushion).toBe(MIN);
    expect(result.balanceAfter).toBe(64_130_458.18);
    expect(result.verdict.level).toBe("vert");
    expect(result.reference).toBeNull();
  });
  it("bornes de bout en bout : égal = Vert, un centime de moins = Orange, négatif = Rouge", () => {
    expect(computeTreasury(input(DEFAULT_SETTINGS, 120_850_558.05 - MIN)).verdict.level).toBe("vert");
    expect(computeTreasury(input(DEFAULT_SETTINGS, 120_850_558.05 - MIN + 0.01)).verdict.level).toBe("orange");
    expect(computeTreasury(input(DEFAULT_SETTINGS, 120_850_558.06)).verdict.level).toBe("rouge");
  });
  it("réglage personnalisé de 30 M DA", () => {
    const result = computeTreasury(input({ ...DEFAULT_SETTINGS, minimumMontant: 30_000_000 }, 100_000_000));
    expect(result.cushion).toBe(30_000_000);
    expect(result.balanceAfter).toBe(20_850_558.05);
    expect(result.verdict.level).toBe("orange");
    expect(result.verdict.sentence).toMatch(/minimum de trésorerie fixé à 30,0 M DA \(30.000.000,00 DA\)/);
  });
  it("le mode « en jours » reste disponible (15 jours = 43,5 M DA ici) et reste Indéterminé sans historique", () => {
    const days: TreasurySettings = { ...DEFAULT_SETTINGS, minimumMode: "jours" };
    expect(computeTreasury(input(days, 60_000_000)).cushion).toBeCloseTo(43_500_000, -4);
    expect(computeTreasury(input(days, 60_000_000, [])).verdict.level).toBe("indetermine");
  });
  it("hypothèses et définition : montant fixe, montant exact écrit", () => {
    const result = computeTreasury(input(DEFAULT_SETTINGS, 56_720_099.87));
    expect(minimumExplanation(result)).toMatch(/20.000.000,00 DA/);
    const lines = buildHypotheses({ balance: { ...balance, freshness: "ok", workingDays: 0 }, computation: result, scenarioName: null, scenarioLines: 0, expectedEnabled: false, includeRequests: false });
    expect(lines.some((line) => line.startsWith("Minimum de trésorerie : montant fixe de ") && /20.000.000,00 DA/.test(line))).toBe(true);
    expect(lines.join(" ")).not.toContain("Réserve conseillée");
  });
});

describe("réglage enregistré : rétrocompatibilité", () => {
  it("ancien réglage en jours seul : passe au montant fixe de 20 M, les jours sont gardés", () => {
    expect(parseSettings({ coussinJours: 30, encaissementsAttendus: true })).toEqual({ minimumMode: "montant", minimumMontant: MIN, coussinJours: 30, encaissementsAttendus: true });
  });
  it("mode « jours » écrit explicitement : conservé ; montant personnalisé relu ; montant absurde ramené à 20 M", () => {
    expect(parseSettings({ minimumMode: "jours", minimumMontant: 30_000_000, coussinJours: 7, encaissementsAttendus: false })).toMatchObject({ minimumMode: "jours", minimumMontant: 30_000_000, coussinJours: 7 });
    expect(parseSettings({ minimumMode: "montant", minimumMontant: 35_500_000.126, coussinJours: 15 }).minimumMontant).toBe(35_500_000.13);
    expect(parseSettings({ minimumMode: "montant", minimumMontant: -5 }).minimumMontant).toBe(MIN);
    expect(parseSettings({ minimumMode: "montant", minimumMontant: "beaucoup" }).minimumMontant).toBe(MIN);
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
  });
  it("validation de la saisie des réglages", () => {
    const ok = { minimumMode: "montant", minimumMontant: 30_000_000, coussinJours: 15, encaissementsAttendus: false };
    expect(treasurySettingsSchema.safeParse(ok).success).toBe(true);
    expect(treasurySettingsSchema.safeParse({ ...ok, minimumMontant: 0 }).success).toBe(false);
    expect(treasurySettingsSchema.safeParse({ ...ok, minimumMontant: -1 }).success).toBe(false);
    expect(treasurySettingsSchema.safeParse({ ...ok, minimumMode: "autre" }).success).toBe(false);
  });
});
