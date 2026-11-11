import { describe, expect, it } from "vitest";
import { PAYROLL_PATTERN, SALARY_WORD } from "@/features/statement/services/statement-parser";

describe("lignes de paie du relevé", () => {
  it("« VIRT DE SALAIRES » seul n'est plus une paie certaine (la banque l'utilise pour des prestataires)", () => {
    const libelle = "VIREMENT ORDONNE : VIRT DE SALAIRES  VIA AGB ONLINE";
    expect(PAYROLL_PATTERN.test(libelle)).toBe(false);
    expect(SALARY_WORD.test(libelle)).toBe(true);
  });

  it("CNAS, IRG, G50 et missions restent de la paie", () => {
    for (const libelle of ["PAIEMENT CNAS OCTOBRE", "VIREMENT IRG", "G50 SEPTEMBRE", "FRAIS DE MISSION ORAN"]) expect(PAYROLL_PATTERN.test(libelle)).toBe(true);
  });
});
