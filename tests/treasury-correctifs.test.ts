import { describe, expect, it } from "vitest";
import { parseTypedAmount } from "@/features/treasury/lib/amount-input";
import { applyValidImport, EMPTY_SOLDE, mergeHistory } from "@/features/treasury/lib/balance-state";
import { computeTreasury } from "@/features/treasury/lib/compute";
import { millions } from "@/features/treasury/lib/format";
import { buildVerdict, riskLevel, spendingReference } from "@/features/treasury/lib/risk";
import type { StatementBalance } from "@/features/treasury/types";

describe("saisie d'un montant (I3)", () => {
  it.each([
    ["22 752 053,00", 22_752_053],
    ["22.752.053", 22_752_053],
    ["22,752,053", 22_752_053],
    ["1.234,56", 1234.56],
    ["1,234.56", 1234.56],
    ["22752053.5", 22_752_053.5],
    ["500 000 DA", 500_000],
  ])("accepte %s", (text, value) => {
    expect(parseTypedAmount(text)).toEqual({ ok: true, value });
  });
  it.each(["22.752", "22,752", "1.23.4", "12,5,6", "abc", "", "1,234,5", "12,345"])("refuse %s", (text) => {
    expect(parseTypedAmount(text).ok).toBe(false);
  });
  it("refuse zéro et le négatif, sauf pour un solde", () => {
    expect(parseTypedAmount("0").ok).toBe(false);
    expect(parseTypedAmount("-5").ok).toBe(false);
    expect(parseTypedAmount("-5 000,50", true)).toEqual({ ok: true, value: -5000.5 });
  });
});

describe("historique insuffisant (I4)", () => {
  it("jamais vert sans réserve calculable", () => {
    expect(riskLevel({ balanceAfter: 9e9, cushion: 0, lowest: 9e9, overdraftDate: null, historyKnown: false })).toBe("indetermine");
    expect(riskLevel({ balanceAfter: -1, cushion: 0, lowest: -1, overdraftDate: "2026-11-23", historyKnown: false })).toBe("rouge");
    const verdict = buildVerdict({ balanceAfter: 9e9, cushion: 0, lowest: 9e9, overdraftDate: null, historyKnown: false, perDay: 0, cushionDays: 15, lowestDate: null });
    expect(verdict.title).toBe("Indéterminé");
    expect(verdict.sentence).toContain("insuffisant");
  });
  it("le calcul complet renvoie « indéterminé » sans historique mensuel", () => {
    const result = computeTreasury({
      today: "2026-11-22",
      balance: { source: "manuel", balance: 500_000_000, date: "2026-11-22", lastOperationDate: null, fileName: "", savedAt: "", savedBy: "", sourceLabel: "test" },
      monthly: [],
      daily: [],
      adjustment: 0,
      cheques: { total: 0, rows: [], toVerify: [], toVerifyTotal: 0 },
      invoices: [],
      preparedBatches: [],
      requestsWithoutInvoice: [],
      includeRequests: false,
      simulationLines: [],
      settings: { minimumMode: "jours", minimumMontant: 20_000_000, coussinJours: 15, encaissementsAttendus: false },
      collections: { rows: [], flows: [], total: 0 },
    } as never);
    expect(result.reference).toBeNull();
    expect(result.verdict.level).toBe("indetermine");
  });
  it("le premier mois partiel de l'historique est exclu de la moyenne", () => {
    const monthly = [
      { m: "2026-05", credit: 0, debit: 10_000_000 },
      { m: "2026-06", credit: 0, debit: 90_000_000 },
      { m: "2026-07", credit: 0, debit: 90_000_000 },
    ];
    expect(spendingReference(monthly, "2026-08-10", "2026-05-20")?.months).toEqual(["2026-06", "2026-07"]);
    expect(spendingReference(monthly, "2026-08-10", "2026-05-01")?.months).toEqual(["2026-05", "2026-06", "2026-07"]);
  });
});

function statement(partial: Partial<StatementBalance> & Pick<StatementBalance, "daily" | "monthly" | "balanceDate">): StatementBalance {
  return {
    balance: 100,
    sens: "CT",
    editedOn: null,
    opening: 0,
    openingDate: null,
    sumCredits: 0,
    sumDebits: 0,
    rowCount: 1,
    lastOperationDate: partial.balanceDate,
    checks: { formula: true, lastLine: true, chain: true } as StatementBalance["checks"],
    gaps: [],
    ...partial,
  } as StatementBalance;
}

describe("un relevé plus court n'écrase pas l'historique (I4)", () => {
  const long = statement({
    balanceDate: "2026-10-31",
    daily: [{ d: "2026-01-01", b: 1 }, { d: "2026-10-31", b: 5 }],
    monthly: [{ m: "2026-01", credit: 0, debit: 40 }, { m: "2026-09", credit: 0, debit: 90 }, { m: "2026-10", credit: 0, debit: 95 }],
  });
  const short = statement({
    balanceDate: "2026-11-20",
    daily: [{ d: "2026-10-20", b: 7 }, { d: "2026-11-20", b: 9 }],
    monthly: [{ m: "2026-10", credit: 0, debit: 12 }, { m: "2026-11", credit: 0, debit: 30 }],
  });
  it("réunit les jours et garde le mois complet de l'ancien relevé", () => {
    const merged = mergeHistory(long, short);
    expect(merged.daily.map((p) => p.d)).toEqual(["2026-01-01", "2026-10-20", "2026-10-31", "2026-11-20"]);
    expect(merged.monthly).toEqual([
      { m: "2026-01", credit: 0, debit: 40 },
      { m: "2026-09", credit: 0, debit: 90 },
      { m: "2026-10", credit: 0, debit: 95 },
      { m: "2026-11", credit: 0, debit: 30 },
    ]);
  });
  it("applyValidImport enregistre l'historique fusionné, solde du plus récent", () => {
    const first = applyValidImport(EMPTY_SOLDE, long, { fileName: "a.xls", importedAt: "2026-11-01T00:00:00Z", importedBy: "x" });
    if (first.action !== "stored" || !first.state.current) throw new Error("attendu");
    const second = applyValidImport(first.state, short, { fileName: "b.xls", importedAt: "2026-11-21T00:00:00Z", importedBy: "x" });
    if (second.action !== "stored" || !second.state.current) throw new Error("attendu");
    expect(second.state.current.balanceDate).toBe("2026-11-20");
    expect(second.state.current.monthly.find((f) => f.m === "2026-10")?.debit).toBe(95);
    expect(second.state.current.monthly.map((f) => f.m)).toContain("2026-01");
  });
});

describe("montants courts dans les phrases (M4)", () => {
  it("jamais « 0,0 M DA »", () => {
    expect(millions(850_000)).not.toContain("M DA");
    expect(millions(850_000)).toMatch(/850.000,00 DA/);
    expect(millions(-120_000)).toMatch(/^−120.000,00 DA/);
    expect(millions(41_378_405.18)).toBe("41,4 M DA");
  });
});
