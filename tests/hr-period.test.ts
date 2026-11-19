import { describe, expect, it } from "vitest";
import { isPeriodNature, validPeriod } from "@/features/hr/lib/hr-period";

describe("classement par période (G50, IRG, IBS)", () => {
  it("reconnaît les natures classées par période", () => {
    expect(isPeriodNature("G50")).toBe(true);
    expect(isPeriodNature("irg")).toBe(true);
    expect(isPeriodNature(" IBS ")).toBe(true);
    expect(isPeriodNature("Salaire")).toBe(false);
    expect(isPeriodNature("CNAS")).toBe(false);
  });
  it("n'accepte qu'une période AAAA-MM valide", () => {
    expect(validPeriod("2026-10")).toBe("2026-10");
    expect(validPeriod("1900-13")).toBe("");
    expect(validPeriod("")).toBe("");
    expect(validPeriod("2026-1")).toBe("");
  });
});
