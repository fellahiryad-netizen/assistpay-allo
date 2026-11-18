import { describe, expect, it } from "vitest";
import { checkHtCeiling, isRealIsoDate, validateAvoirDate } from "@/features/avoirs/lib/avoir-guards";

describe("avoir : date", () => {
  const today = "2026-11-18";
  it("refuse une date inexistante", () => {
    expect(isRealIsoDate("2026-02-31")).toBe(false);
    expect(isRealIsoDate("2026-13-01")).toBe(false);
    expect(isRealIsoDate("2026-02-28")).toBe(true);
    expect(isRealIsoDate("2024-02-29")).toBe(true);
    expect(isRealIsoDate("2026-02-29")).toBe(false);
    expect(validateAvoirDate("2026-02-31", today, null)).toMatch(/n'existe pas/);
  });
  it("refuse une date future", () => {
    expect(validateAvoirDate("2026-11-19", today, null)).toMatch(/postérieure/);
    expect(validateAvoirDate(today, today, null)).toBeNull();
  });
  it("refuse une année antérieure à l'année en cours", () => {
    expect(validateAvoirDate("2025-12-31", today, null)).toMatch(/année antérieure/);
    expect(validateAvoirDate("2026-01-01", today, null)).toBeNull();
  });
  it("garde la borne « pas avant la facture »", () => {
    expect(validateAvoirDate("2026-03-01", today, "2026-03-02")).toMatch(/précéder/);
    expect(validateAvoirDate("2026-03-02", today, "2026-03-02")).toBeNull();
  });
});

describe("avoir : plafond HT cumulé", () => {
  it("accepte jusqu'au HT de la facture (tolérance 0,02)", () => {
    expect(checkHtCeiling(1000, [-400], 600)).toBeNull();
    expect(checkHtCeiling(1000, [-400], 600.02)).toBeNull();
    expect(checkHtCeiling(1000, [], 1000)).toBeNull();
  });
  it("refuse un dépassement et propose le mode total", () => {
    const message = checkHtCeiling(1000, [-400], 600.03);
    expect(message).toMatch(/dépasserait/);
    expect(message).toMatch(/« total »/);
    expect(message).toMatch(/600\.00/);
  });
  it("les avoirs annulés ne sont pas transmis : seul le cumul fourni compte", () => {
    expect(checkHtCeiling(1000, [], 999)).toBeNull();
  });
});
