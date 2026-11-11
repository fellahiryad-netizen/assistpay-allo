import { describe, expect, it } from "vitest";
import { amountInWords, parseLooseAmount, round2 } from "@/utils/amounts";

describe("montants", () => {
  it("arrondit au centime", () => {
    expect(round2(5302104.504)).toBe(5302104.5);
    expect(round2(0.1 + 0.2)).toBe(0.3);
  });

  it("lit les formats de banque", () => {
    expect(parseLooseAmount("5 435 384,50")).toBe(5435384.5);
    expect(parseLooseAmount("1.234,56")).toBe(1234.56);
    expect(parseLooseAmount("1,234.56")).toBe(1234.56);
    expect(parseLooseAmount("15000 DA")).toBe(15000);
    expect(parseLooseAmount("(200)")).toBe(-200);
    expect(Number.isNaN(parseLooseAmount("abc"))).toBe(true);
  });

  it("écrit un montant en lettres", () => {
    expect(amountInWords(3664000)).toMatch(/^Trois millions six cent soixante-quatre mille dinars$/);
    expect(amountInWords(12.5)).toContain("centime");
  });

  it("le débours HT + TVA 19 % de la facture BDG 117&118 est exact", () => {
    expect(round2(4455550 * 1.19)).toBe(5302104.5);
    expect(round2(5302104.5 + 133280)).toBe(5435384.5);
  });
});
