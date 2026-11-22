import { describe, expect, it } from "vitest";
import { buildReceivables, filterByActivity, toReceivableLine } from "@/features/receivables/lib/aggregate";
import { ageInDays, agingKeyOf } from "@/features/receivables/lib/aging";
import { companyColor, monogramOf } from "@/features/receivables/lib/colors";
import { activityOfCategorie, companyOf, companySlug } from "@/features/receivables/lib/company";
import { invoicesHref } from "@/features/receivables/lib/links";
import { sharesPercent } from "@/features/receivables/lib/percent";
import type { ReceivableInput } from "@/features/receivables/types";

const TODAY = "2026-11-22";
let seq = 0;
function inv(categorie: string, montant: number, dateFacture: string | null, dateOperation: string | null = null): ReceivableInput {
  seq += 1;
  return { id: `i${seq}`, categorie, numero: `N${seq}`, libelle: "", montant, dateFacture, dateOperation };
}
const lines = (rows: ReceivableInput[]) => rows.map((row) => toReceivableLine(row, TODAY));

describe("companyOf / activityOfCategorie", () => {
  it.each([
    ["CAAR", "CAAR", "ASSISTANCE"],
    ["BDG CAAT", "CAAT", "BDG"],
    ["GAM", "GAM", "ASSISTANCE"],
    ["CAAT", "CAAT", "ASSISTANCE"],
    ["TRUST", "TRUST", "ASSISTANCE"],
    ["GAM BDG", "GAM", "BDG"],
    ["MLA", "MLA", "ASSISTANCE"],
    ["TPA", "TPA", "AUTRE"],
    ["Trust BDG", "TRUST", "BDG"],
    ["AUTO QUAL", "AUTO QUAL", "AUTRE"],
  ])("%s → %s / %s", (categorie, company, activity) => {
    expect(companyOf(categorie)).toBe(company);
    expect(activityOfCategorie(categorie)).toBe(activity);
  });
  it("ignore la casse, les accents et les espaces", () => {
    expect(companyOf("  gam   bdg ")).toBe("GAM");
    expect(companyOf("trust  BDG")).toBe("TRUST");
    expect(companyOf("bdg caat")).toBe("CAAT");
    expect(companyOf("auto   qual")).toBe("AUTO QUAL");
    expect(activityOfCategorie("caar")).toBe("ASSISTANCE");
  });
  it("catégorie vide, nulle ou blanche → Sans catégorie", () => {
    for (const value of ["", "   ", null, undefined]) expect(companyOf(value)).toBe("Sans catégorie");
    expect(activityOfCategorie("")).toBe("AUTRE");
  });
  it("valeur inconnue : gardée en majuscules, activité Autre ; BDG seul reste BDG", () => {
    expect(companyOf("Nouvelle Cie")).toBe("NOUVELLE CIE");
    expect(activityOfCategorie("Nouvelle Cie")).toBe("AUTRE");
    expect(companyOf("BDG")).toBe("BDG");
    expect(activityOfCategorie("BDG")).toBe("BDG");
  });
  it("slug de fichier de logo", () => {
    expect(companySlug("AUTO QUAL")).toBe("auto-qual");
    expect(companySlug("CAAR")).toBe("caar");
  });
});

describe("ancienneté", () => {
  it("date de facture, sinon d'opération, sinon aucune", () => {
    expect(ageInDays("2026-11-12", null, TODAY)).toBe(10);
    expect(ageInDays(null, "2026-11-02", TODAY)).toBe(20);
    expect(ageInDays(null, null, TODAY)).toBeNull();
    expect(ageInDays("2026-12-01", null, TODAY)).toBe(0);
  });
  it("tranches aux bornes", () => {
    expect([0, 30, 31, 60, 61, 90, 91, 500].map(agingKeyOf)).toEqual(["D0_30", "D0_30", "D31_60", "D31_60", "D61_90", "D61_90", "D90_PLUS", "D90_PLUS"]);
    expect(agingKeyOf(null)).toBe("SANS_DATE");
  });
});

describe("parts en %", () => {
  it("somme exactement 100,0 malgré les arrondis", () => {
    const shares = sharesPercent([1, 1, 1]);
    expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 10);
    expect(shares).toEqual([33.4, 33.3, 33.3]);
  });
  it("cas réaliste et total nul", () => {
    const shares = sharesPercent([99116304.53, 74801956.77, 36060354.98, 51440753.19, 11927294.44, 2658460, 14937155.5, 130000]);
    expect(Math.round(shares.reduce((a, b) => a + b, 0) * 10)).toBe(1000);
    expect(sharesPercent([0, 0])).toEqual([0, 0]);
    expect(sharesPercent([])).toEqual([]);
  });
});

describe("buildReceivables", () => {
  const data = lines([
    inv("CAAT", 1000.1, "2026-11-01"),
    inv("BDG CAAT", 2000.2, "2026-08-01"),
    inv("GAM", 500.05, "2026-10-01"),
    inv("GAM BDG", 300.03, "2026-06-01"),
    inv("TPA", 100.01, null),
    inv("", 50, null, "2026-11-12"),
    inv("Trust BDG", 10, null),
  ]);
  const summary = buildReceivables(data, TODAY);
  const sum = (values: number[]): number => Math.round(values.reduce((a, b) => a + b, 0) * 100) / 100;

  it("somme des compagnies = total global = somme des factures", () => {
    expect(summary.total).toBe(sum(data.map((line) => line.montant)));
    expect(sum(summary.companies.map((row) => row.amount))).toBe(summary.total);
    expect(summary.count).toBe(7);
    expect(summary.companies.reduce((n, row) => n + row.count, 0)).toBe(7);
  });
  it("réunit BDG CAAT avec CAAT, GAM BDG avec GAM", () => {
    const names = summary.companies.map((row) => row.company);
    expect(names).toEqual(["CAAT", "GAM", "TPA", "Sans catégorie", "TRUST"].sort((a, b) => names.indexOf(a) - names.indexOf(b)));
    const caat = summary.companies.find((row) => row.company === "CAAT");
    expect(caat?.amount).toBe(3000.3);
    expect(caat?.categories).toEqual(["BDG CAAT", "CAAT"]);
    expect(caat?.byActivity.ASSISTANCE.amount).toBe(1000.1);
    expect(caat?.byActivity.BDG.amount).toBe(2000.2);
  });
  it("ventilation par activité = total (global et par compagnie)", () => {
    const { ASSISTANCE, BDG, AUTRE } = summary.byActivity;
    expect(sum([ASSISTANCE.amount, BDG.amount, AUTRE.amount])).toBe(summary.total);
    expect(ASSISTANCE.count + BDG.count + AUTRE.count).toBe(7);
    for (const row of summary.companies) expect(sum(Object.values(row.byActivity).map((x) => x.amount))).toBe(row.amount);
  });
  it("tranches d'ancienneté = total, y compris sans date", () => {
    expect(sum(Object.values(summary.aging).map((x) => x.amount))).toBe(summary.total);
    expect(Object.values(summary.aging).reduce((n, x) => n + x.count, 0)).toBe(7);
    for (const row of summary.companies) expect(sum(Object.values(row.aging).map((x) => x.amount))).toBe(row.amount);
    expect(summary.aging.D0_30.count).toBe(2); // CAAT 21 j, sans catégorie 10 j (date d'opération)
    expect(summary.aging.D90_PLUS.count).toBe(2);
  });
  it("factures sans date repérées", () => {
    expect(summary.undated.count).toBe(2);
    expect(summary.undated.amount).toBe(110.01);
    expect(summary.attention.undated.map((item) => item.company).sort()).toEqual(["TPA", "TRUST"]);
    expect(summary.attention.over90.map((item) => item.company).sort()).toEqual(["CAAT", "GAM"]);
  });
  it("plus ancienne facture par compagnie", () => {
    const caat = summary.companies.find((row) => row.company === "CAAT");
    expect(caat?.oldestDate).toBe("2026-08-01");
    expect(caat?.oldestDays).toBe(113);
    expect(summary.companies.find((row) => row.company === "TPA")?.oldestDays).toBeNull();
  });
  it("parts = 100 et compagnie la plus exposée", () => {
    expect(Math.round(summary.companies.reduce((s, row) => s + row.share, 0) * 10)).toBe(1000);
    expect(summary.mostExposed?.company).toBe("CAAT");
  });
  it("ancienneté moyenne pondérée : montants et jours, sans les factures sans date", () => {
    const dated = [
      [1000.1, 21],
      [2000.2, 113],
      [500.05, 52],
      [300.03, 174],
      [50, 10],
    ] as const;
    const expected = dated.reduce((s, [a, d]) => s + a * d, 0) / dated.reduce((s, [a]) => s + a, 0);
    expect(summary.weightedAgeDays).toBe(Math.round(expected * 10) / 10);
    expect(buildReceivables(lines([inv("CAAT", 5, null)]), TODAY).weightedAgeDays).toBeNull();
  });
  it("filtre d'activité : le total suit", () => {
    const bdg = buildReceivables(filterByActivity(data, "BDG"), TODAY);
    expect(bdg.total).toBe(sum([2000.2, 300.03, 10]));
    expect(bdg.byActivity.ASSISTANCE.count).toBe(0);
    expect(filterByActivity(data, null)).toHaveLength(7);
  });
  it("liste vide", () => {
    const empty = buildReceivables([], TODAY);
    expect(empty.total).toBe(0);
    expect(empty.companies).toEqual([]);
    expect(empty.mostExposed).toBeNull();
    expect(empty.weightedAgeDays).toBeNull();
  });
  it("additionne au centime sans dérive", () => {
    const many = buildReceivables(lines(Array.from({ length: 1000 }, () => inv("GAM", 0.1, "2026-11-01"))), TODAY);
    expect(many.total).toBe(100);
  });
});

describe("liens et présentation", () => {
  it("lien exact avec une catégorie, recherche avec plusieurs", () => {
    expect(invoicesHref("CAAR", ["CAAR"], {})).toBe("/factures?sens=CREDIT&status=EN_ATTENTE&categorie=CAAR");
    expect(invoicesHref("CAAT", ["BDG CAAT", "CAAT"], { annee: 2026 })).toBe("/factures?sens=CREDIT&status=EN_ATTENTE&annee=2026&q=CAAT");
    expect(invoicesHref(null, [], {})).toBe("/factures?sens=CREDIT&status=EN_ATTENTE");
  });
  it("couleur stable et monogramme", () => {
    expect(companyColor("CAAR")).toBe(companyColor("CAAR"));
    expect(companyColor("CAAR")).not.toBe(companyColor("CAAT"));
    expect(companyColor("INCONNUE")).toMatch(/^#[0-9A-F]{6}$/);
    expect(monogramOf("AUTO QUAL")).toBe("AQ");
    expect(monogramOf("CAAR")).toBe("CAAR");
    expect(monogramOf("TRUST")).toBe("TRU");
  });
});
