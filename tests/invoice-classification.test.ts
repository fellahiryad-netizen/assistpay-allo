import { describe, expect, it } from "vitest";
import {
  ALL_MONTHS,
  NO_DATE_MONTH,
  classificationConditions,
  classify,
  defaultMonth,
  groupOf,
  matchesSupplier,
  supplierKey,
  monthLabel,
  monthOf,
  monthRange,
  type ClassifiableRow,
} from "@/features/invoices/lib/classification";

const GROUPS = { GAM: ["GAM", "Honoraire GAM"], CAAT: ["CAAT"] } as const;

const row = (over: Partial<ClassifiableRow>): ClassifiableRow => ({
  status: "EN_ATTENTE",
  categorie: "GAM",
  tiers: "Prestataire A",
  dateFacture: "2026-11-05",
  dateOperation: null,
  montant: 1000,
  ...over,
});

describe("monthOf et monthLabel", () => {
  it("prend la date de facture, sinon la date de règlement, sinon sans date", () => {
    expect(monthOf({ dateFacture: "2026-10-31", dateOperation: "2026-11-02" })).toBe("2026-10");
    expect(monthOf({ dateFacture: null, dateOperation: "2026-11-02" })).toBe("2026-11");
    expect(monthOf({ dateFacture: null, dateOperation: null })).toBe(NO_DATE_MONTH);
  });
  it("écrit le mois en français", () => {
    expect(monthLabel("2026-11")).toBe("Novembre 2026");
    expect(monthLabel("2026-08")).toBe("Août 2026");
    expect(monthLabel(NO_DATE_MONTH)).toBe("Sans date");
    expect(monthLabel(ALL_MONTHS)).toBe("Tous les mois");
  });
});

describe("groupOf", () => {
  it("regroupe les catégories d'un même partenaire et utilise le tiers pour les fournisseurs", () => {
    expect(groupOf({ categorie: "Honoraire GAM", tiers: "x" }, "CREDIT", GROUPS)).toBe("GAM");
    expect(groupOf({ categorie: "", tiers: "x" }, "CREDIT", GROUPS)).toBe("Sans catégorie");
    expect(groupOf({ categorie: "CAAT", tiers: "  Bouafia  " }, "DEBIT", GROUPS)).toBe("Bouafia");
    expect(groupOf({ categorie: "", tiers: " " }, "DEBIT", GROUPS)).toBe("Sans nom");
  });
});

describe("defaultMonth", () => {
  it("garde le mois courant s'il a des factures", () => {
    expect(defaultMonth([row({}), row({ dateFacture: "2026-09-01" })], "2026-11")).toBe("2026-11");
  });
  it("sinon prend le mois le plus récent qui en a, sinon tous", () => {
    expect(defaultMonth([row({ dateFacture: "2026-09-01" }), row({ dateFacture: "2026-10-12" })], "2026-11")).toBe("2026-10");
    expect(defaultMonth([], "2026-11")).toBe(ALL_MONTHS);
    expect(defaultMonth([row({ dateFacture: null })], "2026-11")).toBe(ALL_MONTHS);
  });
});

describe("classify", () => {
  const rows = [
    row({ montant: 100 }),
    row({ montant: 250.5, status: "REGLE", dateOperation: "2026-11-20" }),
    row({ categorie: "CAAT", montant: 40, dateFacture: "2026-10-03" }),
    row({ categorie: "Honoraire GAM", montant: 10, dateFacture: "2026-10-09", status: "REGLE" }),
    row({ categorie: "CAAT", montant: 5, dateFacture: null, dateOperation: null }),
  ];
  const base = { sens: "CREDIT" as const, currentMonth: "2026-11", groups: GROUPS };

  it("applique le mois courant par défaut avec compteurs et totaux", () => {
    const result = classify(rows, { ...base, useDefaultMonth: true });
    expect(result.mois).toBe("2026-11");
    expect(result.tabs).toEqual({ TOUTES: 2, A_REGLER: 1, REGLEES: 1 });
    expect(result.groups.map((g) => [g.value, g.count, g.total])).toEqual([
      ["", 2, 350.5],
      ["GAM", 2, 350.5],
    ]);
    expect(result.months.map((m) => m.value)).toEqual([ALL_MONTHS, "2026-11", "2026-10", NO_DATE_MONTH]);
    expect(result.months[0]).toMatchObject({ count: 5, total: 405.5, active: false });
    expect(result.months[1]).toMatchObject({ count: 2, active: true });
  });

  it("sans mois par défaut, couvre tous les mois", () => {
    const result = classify(rows, { ...base, useDefaultMonth: false });
    expect(result.mois).toBe(ALL_MONTHS);
    expect(result.tabs.TOUTES).toBe(5);
    expect(result.groups.map((g) => g.value)).toEqual(["", "CAAT", "GAM"]);
  });

  it("croise partenaire et mois, et garde l'entrée choisie même vide", () => {
    const result = classify(rows, { ...base, p: "CAAT", mois: "2026-11", useDefaultMonth: false });
    expect(result.tabs.TOUTES).toBe(0);
    expect(result.groups.find((g) => g.value === "CAAT")).toMatchObject({ count: 0, active: true });
    expect(result.months.map((m) => m.value)).toEqual([ALL_MONTHS, "2026-11", "2026-10", NO_DATE_MONTH]);
    expect(result.months.find((m) => m.value === "2026-10")?.count).toBe(1);
  });

  it("tient compte de l'onglet de statut dans les barres", () => {
    const result = classify(rows, { ...base, status: "REGLE", mois: ALL_MONTHS, useDefaultMonth: false });
    expect(result.groups[0]).toMatchObject({ count: 2, total: 260.5 });
    expect(result.tabs.TOUTES).toBe(5);
  });

  it("regroupe les fournisseurs par tiers", () => {
    const result = classify([row({ tiers: "B" }), row({ tiers: "A" }), row({ tiers: "A", montant: 1 })], { ...base, sens: "DEBIT", mois: ALL_MONTHS, useDefaultMonth: false });
    expect(result.groups.map((g) => [g.label, g.count])).toEqual([["Tous les fournisseurs", 3], ["A", 2], ["B", 1]]);
  });

  it("passe au dernier mois utile quand le mois courant est vide", () => {
    const result = classify([row({ dateFacture: "2026-08-14" })], { ...base, useDefaultMonth: true });
    expect(result.mois).toBe("2026-08");
  });
});

describe("monthRange et classificationConditions", () => {
  it("donne les bornes d'un mois, y compris décembre", () => {
    expect(monthRange("2026-12")).toEqual({ start: new Date("2026-12-01T00:00:00Z"), end: new Date("2027-01-01T00:00:00Z") });
    expect(monthRange("2026-13")).toBeNull();
    expect(monthRange("tous")).toBeNull();
  });
  it("ne filtre rien pour tous les mois et tous les partenaires", () => {
    expect(classificationConditions({ sens: "CREDIT", mois: ALL_MONTHS }, GROUPS)).toEqual([]);
    expect(classificationConditions({}, GROUPS)).toEqual([]);
  });
  it("filtre un partenaire par les catégories de son groupe", () => {
    expect(classificationConditions({ sens: "CREDIT", p: "GAM" }, GROUPS)).toEqual([{ categorie: { in: ["GAM", "Honoraire GAM"] } }]);
    expect(classificationConditions({ sens: "CREDIT", p: "Sans catégorie" }, GROUPS)).toEqual([{ categorie: { in: [""] } }]);
    expect(classificationConditions({ sens: "CREDIT", p: "MLA" }, GROUPS)).toEqual([{ categorie: { in: ["MLA"] } }]);
  });
  it("filtre un fournisseur par son nom et un mois par date de facture ou de règlement", () => {
    const [supplier, month] = classificationConditions({ sens: "DEBIT", p: "Bouafia", mois: "2026-11" }, GROUPS);
    expect(supplier).toEqual({ tiers: { equals: "Bouafia", mode: "insensitive" } });
    expect(month).toEqual({
      OR: [
        { dateFacture: { gte: new Date("2026-11-01T00:00:00Z"), lt: new Date("2026-12-01T00:00:00Z") } },
        { dateFacture: null, dateOperation: { gte: new Date("2026-11-01T00:00:00Z"), lt: new Date("2026-12-01T00:00:00Z") } },
      ],
    });
  });
  it("filtre les factures sans aucune date", () => {
    expect(classificationConditions({ sens: "DEBIT", mois: NO_DATE_MONTH }, GROUPS)).toEqual([{ dateFacture: null, dateOperation: null }]);
  });
});

describe("fournisseurs : clé de groupe normalisée (casse, espaces)", () => {
  const debit = { sens: "DEBIT" as const, useDefaultMonth: false, currentMonth: "2026-11", groups: {} };
  it("regroupe les variantes de casse et d'espaces en un seul fournisseur", () => {
    const rows = [row({ tiers: "Bouafia Mohamed" }), row({ tiers: "  BOUAFIA   mohamed " }), row({ tiers: "bouafia mohamed" })];
    const result = classify(rows, debit);
    expect(result.groups).toHaveLength(2);
    expect(result.groups[1]).toMatchObject({ count: 3, total: 3000 });
  });
  it("le filtre par fournisseur retient toutes les variantes, comme la liste", () => {
    const rows = [row({ tiers: "Bouafia  Mohamed" }), row({ tiers: "BOUAFIA MOHAMED" }), row({ tiers: "Autre" })];
    const result = classify(rows, { ...debit, p: "Bouafia Mohamed" });
    expect(result.tabs.TOUTES).toBe(2);
    expect(result.groups.find((entry) => entry.active)).toMatchObject({ count: 2 });
  });
  it("« Sans nom » regroupe les noms vides ou blancs", () => {
    const result = classify([row({ tiers: "" }), row({ tiers: "   " })], { ...debit, p: "Sans nom" });
    expect(result.tabs.TOUTES).toBe(2);
    expect(groupOf(row({ tiers: " " }), "DEBIT", {})).toBe("Sans nom");
  });
  it("matchesSupplier et supplierKey sont insensibles à la casse et aux espaces", () => {
    expect(matchesSupplier(" Bouafia   MOHAMED", "bouafia mohamed")).toBe(true);
    expect(matchesSupplier("Autre", "bouafia mohamed")).toBe(false);
    expect(supplierKey("")).toBe(supplierKey("  "));
  });
  it("le filtre de base utilise les valeurs brutes calculées par le service", () => {
    const [condition] = classificationConditions({ sens: "DEBIT", p: "Bouafia Mohamed" }, {}, ["Bouafia Mohamed", " BOUAFIA  Mohamed"]);
    expect(condition).toEqual({ tiers: { in: ["Bouafia Mohamed", " BOUAFIA  Mohamed"] } });
  });
  it("expose les impayés de tous les mois, sans le mois par défaut", () => {
    const rows = [row({ dateFacture: "2026-11-05" }), row({ dateFacture: "2026-03-05" })];
    const byDefault = classify(rows, { sens: "CREDIT", useDefaultMonth: true, currentMonth: "2026-11", groups: GROUPS });
    expect(byDefault.mois).toBe("2026-11");
    expect(byDefault.tabs.A_REGLER).toBe(1);
    expect(byDefault.unpaidAllMonths).toBe(2);
  });
});
