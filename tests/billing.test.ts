import { describe, expect, it } from "vitest";
import { nextCaatBdgNumbers, nextClientNumber, nextGamAbNumber, nextTrustBdgNumbers, periodLabel } from "@/features/billing/services/billing-calc";

describe("numérotation des factures", () => {
  it("continue la série CAAT BDG (débours puis frais)", () => {
    const [deb, fra] = nextCaatBdgNumbers(2026, ["CAAT 26-117BDG", "CAAT 26-118BDG", "CAAT 26-155&156BDG"]);
    expect(deb).toBe("CAAT 26-000157BDG");
    expect(fra).toBe("CAAT 26-000158BDG");
  });

  it("repart de 1 sans historique", () => {
    expect(nextCaatBdgNumbers(2026, [])[0]).toBe("CAAT 26-000001BDG");
    expect(nextGamAbNumber(2026, [])).toBe("000001-2026 AB");
    expect(nextTrustBdgNumbers(2026, [])[0]).toBe("TRUST 000001-2026 BDG");
  });

  it("incrémente les numéros TRUST et GAM", () => {
    expect(nextTrustBdgNumbers(2026, ["TRUST 000012-2026 BDG"])).toEqual(["TRUST 000013-2026 BDG", "TRUST 000014-2026 BDG"]);
    expect(nextGamAbNumber(2026, ["AB 018-2026"])).toBe("000019-2026 AB");
  });

  it("incrémente le numéro client", () => {
    expect(nextClientNumber("GAM 26-", 2026, ["GAM 26-000056"])).toBe("GAM 26-000057");
  });

  it("met la période en lettres", () => {
    expect(periodLabel("2026-09")).toBe("SEPTEMBRE 2026");
    expect(periodLabel("")).toBe("");
  });
});
