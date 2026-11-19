import { describe, expect, it } from "vitest";
import { aggregateDate, isPeriodNature, monthKeyOfEntry, storedYear, validPeriod, yearOfEntry } from "@/features/hr/lib/hr-period";

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

describe("année et mois de rattachement", () => {
  const base = { nature: "G50", mois: "", annee: null as number | null, date: null as string | null };

  it("G50 de décembre 2025 saisi en 2026 : rattaché à 2025-12", () => {
    const entry = { ...base, mois: "2025-12", annee: 2026, date: "2026-01-10" };
    expect(yearOfEntry(entry)).toBe(2025);
    expect(monthKeyOfEntry(entry)).toBe("2025-12");
  });

  it("G50 d'octobre payé en novembre : 2026-10", () => {
    expect(monthKeyOfEntry({ ...base, mois: "2026-10", annee: 2026, date: "2026-11-20" })).toBe("2026-10");
  });

  it("salaire : le mois de la date de paiement", () => {
    expect(monthKeyOfEntry({ ...base, nature: "Salaire", mois: "2026-10", annee: 2026, date: "2026-11-02" })).toBe("2026-11");
  });

  it("mois invalide ou vide : repli sur la date", () => {
    expect(monthKeyOfEntry({ ...base, mois: "2026-13", annee: 2026, date: "2026-11-20" })).toBe("2026-11");
    expect(monthKeyOfEntry({ ...base, mois: "", annee: 2026, date: "2026-11-20" })).toBe("2026-11");
  });

  it("année absente : déduite du mois puis de la date", () => {
    expect(yearOfEntry({ ...base, nature: "Salaire", mois: "2025-12", date: "2026-01-05" })).toBe(2025);
    expect(yearOfEntry({ ...base, nature: "Salaire", mois: "", date: "2026-01-05" })).toBe(2026);
    expect(yearOfEntry({ ...base, nature: "Salaire" })).toBe(0);
  });

  it("année enregistrée : période pour G50, date pour un salaire", () => {
    expect(storedYear("G50", "2025-12", "2026-01-10")).toBe(2025);
    expect(storedYear("Salaire", "2025-12", "2026-01-10")).toBe(2026);
    expect(storedYear("G50", "", "2026-01-10")).toBe(2026);
  });
});

describe("date de l'agrégat mensuel", () => {
  it("G50 de septembre payé le 20/10 : l'agrégat de septembre reste en septembre", () => {
    expect(aggregateDate("2026-09", 2026, ["2026-10-20"])).toBe("2026-09-30");
  });
  it("dernier paiement du mois de rattachement s'il existe", () => {
    expect(aggregateDate("2026-09", 2026, ["2026-09-12", "2026-10-20", "2026-09-25"])).toBe("2026-09-25");
  });
  it("février bissextile et sans mois de rattachement", () => {
    expect(aggregateDate("2028-02", 2028, [])).toBe("2028-02-29");
    expect(aggregateDate("", 2026, ["2025-12-31", "2026-03-04"])).toBe("2026-03-04");
    expect(aggregateDate("", 2026, [])).toBe("");
  });
});
