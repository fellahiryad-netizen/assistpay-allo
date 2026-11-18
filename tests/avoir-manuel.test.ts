import { describe, expect, it } from "vitest";
import { createAvoirSchema } from "@/features/avoirs/schemas";
import { manualAvoirAmounts, remainingAvoirable } from "@/features/avoirs/lib/avoir-calc";
import { filterAvoirable, type AvoirSearchable } from "@/features/avoirs/lib/avoir-filter";

const base = { origineId: "abc", categorie: "erreur_montant" as const, motif: "Erreur de ventilation", suite: "aucune" as const };

describe("avoir : montant libre", () => {
  it("saisie HT : TVA 19 % calculée", () => {
    expect(manualAvoirAmounts("ht", 1000)).toMatchObject({ ht: 1000, tva: 190, ttc: 1190, ecartArrondi: 0, coherent: true });
    expect(manualAvoirAmounts("ht", 333.33)).toMatchObject({ ht: 333.33, tva: 63.33, ttc: 396.66, coherent: true });
  });
  it("saisie TTC : HT et TVA déduits, TTC conservé", () => {
    expect(manualAvoirAmounts("ttc", 1190)).toMatchObject({ ht: 1000, tva: 190, ttc: 1190, ecartArrondi: 0, coherent: true });
    const odd = manualAvoirAmounts("ttc", 100);
    expect(odd.ttc).toBe(100);
    expect(Math.round((odd.ht + odd.tva) * 100)).toBe(10000);
    expect(Math.abs(odd.ecartArrondi)).toBeLessThanOrEqual(0.01);
    expect(odd.coherent).toBe(true);
  });
  it("HT + TVA = TTC au centime sur une série de montants", () => {
    for (let ttc = 0.01; ttc < 500; ttc += 7.77) {
      const result = manualAvoirAmounts("ttc", ttc);
      expect(Math.round(result.ht * 100) + Math.round(result.tva * 100)).toBe(Math.round(result.ttc * 100));
      expect(result.coherent).toBe(true);
    }
  });
  it("le reste avoirable bloque un dépassement", () => {
    const reste = remainingAvoirable(1190, [-500]);
    expect(reste).toBe(690);
    expect(manualAvoirAmounts("ht", 600).ttc).toBeGreaterThan(reste);
    expect(manualAvoirAmounts("ht", 500).ttc).toBeLessThanOrEqual(reste);
  });
});

describe("avoir : schéma", () => {
  it("motif obligatoire, quelle que soit la catégorie", () => {
    expect(createAvoirSchema.safeParse({ ...base, mode: "total", motif: "" }).success).toBe(false);
    expect(createAvoirSchema.safeParse({ ...base, mode: "total", motif: "ab" }).success).toBe(false);
    expect(createAvoirSchema.safeParse({ ...base, mode: "total" }).success).toBe(true);
  });
  it("montant libre : saisie et montant requis", () => {
    expect(createAvoirSchema.safeParse({ ...base, mode: "manuel" }).success).toBe(false);
    expect(createAvoirSchema.safeParse({ ...base, mode: "manuel", saisie: "ht" }).success).toBe(false);
    expect(createAvoirSchema.safeParse({ ...base, mode: "manuel", saisie: "ttc", montant: 100 }).success).toBe(true);
    expect(createAvoirSchema.safeParse({ ...base, mode: "manuel", saisie: "ttc", montant: -5 }).success).toBe(false);
  });
  it("facture d'origine obligatoire", () => {
    expect(createAvoirSchema.safeParse({ ...base, origineId: "", mode: "total" }).success).toBe(false);
  });
});

describe("avoir : recherche de la facture d'origine", () => {
  const make = (id: string, patch: Partial<AvoirSearchable>): AvoirSearchable & { id: string } => ({
    id, num: id, num2: "", client: "CAAT", clientLabel: "CAAT", succ: "", perTxt: "", objet: "", ttc: 1000, reste: 1000, ...patch,
  });
  const list = [
    make("CAAT 26-000142", { ttc: 1190000, reste: 1190000, succ: "Oran" }),
    make("GAM 26-000010", { client: "GAM", clientLabel: "GAM BDG", ttc: 5000, reste: 0 }),
    make("TRUST 26-000007", { client: "TRUST", clientLabel: "TRUST Assurance", ttc: 250.5, reste: 250.5 }),
  ];
  it("par compagnie", () => {
    expect(filterAvoirable(list, "TRUST", "").map((i) => i.id)).toEqual(["TRUST 26-000007"]);
  });
  it("par numéro et par succursale", () => {
    expect(filterAvoirable(list, "", "000142").map((i) => i.id)).toEqual(["CAAT 26-000142"]);
    expect(filterAvoirable(list, "", "oran").map((i) => i.id)).toEqual(["CAAT 26-000142"]);
  });
  it("par montant TTC", () => {
    expect(filterAvoirable(list, "", "1 190 000").map((i) => i.id)).toEqual(["CAAT 26-000142"]);
    expect(filterAvoirable(list, "", "250,50").map((i) => i.id)).toEqual(["TRUST 26-000007"]);
  });
  it("écarte les factures sans reste avoirable", () => {
    expect(filterAvoirable(list, "GAM", "")).toEqual([]);
  });
});
