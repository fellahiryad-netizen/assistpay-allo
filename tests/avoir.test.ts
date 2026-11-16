import { describe, expect, it } from "vitest";
import { avoirAmounts, nextAvoirNumber, remainingAvoirable } from "@/features/avoirs/lib/avoir-calc";

describe("avoir", () => {
  const origin = { ht: 1000, tva: 190, ttc: 1190 };
  it("total : reprend la facture", () => {
    expect(avoirAmounts(origin, "total")).toEqual(origin);
  });
  it("partiel : répartit le TTC comme la facture d'origine", () => {
    expect(avoirAmounts(origin, "partiel", 595)).toEqual({ ht: 500, tva: 95, ttc: 595 });
  });
  it("partiel : HT + TVA = TTC même sur une facture à TVA atypique", () => {
    const odd = { ht: 563785.73, tva: 856669.29, ttc: 1420455.02 };
    const part = avoirAmounts(odd, "partiel", 100000);
    expect(Math.round((part.ht + part.tva) * 100)).toBe(10000000);
  });
  it("reste avoirable", () => {
    expect(remainingAvoirable(1190, [-500, 200])).toBe(490);
    expect(remainingAvoirable(1190, [-1190])).toBe(0);
  });
  it("numérotation AV continue par année", () => {
    expect(nextAvoirNumber([], 2026)).toBe("AV/2026/0001");
    expect(nextAvoirNumber(["AV/2026/0001", "AV/2026/0007", "AV/2025/0099", "CAAT 26-000142"], 2026)).toBe("AV/2026/0008");
  });
});
