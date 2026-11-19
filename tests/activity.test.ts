import { describe, expect, it } from "vitest";
import { activityOf, explicitActivityOf, mergeActivityIntoExtra, suggestActivity } from "@/features/invoices/lib/activity";

describe("activityOf : déduction par la catégorie", () => {
  it.each([
    ["Prestataire BDG", "bdg"],
    ["prestataires BDG", "bdg"],
    ["Avenant BDG", "bdg"],
    ["Prestataire bris de glace", "bdg"],
    ["Bris-de-glace", "bdg"],
    ["Prestataire assistance routière", "assistance"],
    ["Prestataire dépannage", "assistance"],
    ["Remorquage", "assistance"],
    ["ASSISTANCE", "assistance"],
  ])("%s -> %s", (categorie, expected) => {
    expect(activityOf({ categorie })).toBe(expected);
  });

  it.each(["Prestataires TVA", "Prestataire TPA", "Prestataire IT", "Fournisseur", "", "CAAT"])("« %s » reste autre", (categorie) => {
    expect(activityOf({ categorie })).toBe("autre");
  });

  it("BDG l'emporte si la catégorie cite aussi l'assistance", () => {
    expect(activityOf({ categorie: "Prestataire BDG et assistance" })).toBe("bdg");
  });

  it("un mot qui contient « bdg » sans en être un n'est pas BDG", () => {
    expect(activityOf({ categorie: "Prestataire abdgx" })).toBe("autre");
  });

  it("une mention explicite dans la catégorie fait sortir TVA / TPA de « autre »", () => {
    expect(activityOf({ categorie: "Prestataire TPA assistance" })).toBe("assistance");
    expect(activityOf({ categorie: "Prestataires TVA BDG" })).toBe("bdg");
  });

  it("une catégorie renseignée sans mention n'est pas corrigée par le libellé ou le tiers", () => {
    expect(activityOf({ categorie: "Prestataires TVA", libelle: "remorquage Alger", tiers: "Garage assistance", nature: "BDG" })).toBe("autre");
  });

  it("catégorie vide : nature, puis libellé, puis tiers", () => {
    expect(activityOf({ categorie: "", nature: "Facture BDG" })).toBe("bdg");
    expect(activityOf({ categorie: null, libelle: "remorquage VL" })).toBe("assistance");
    expect(activityOf({ categorie: "  ", tiers: "Dépannage Express" })).toBe("assistance");
    expect(activityOf({ nature: "assistance", libelle: "BDG" })).toBe("assistance");
    expect(activityOf({})).toBe("autre");
  });
});

describe("activityOf : activité explicite dans extra", () => {
  it("l'emporte sur la catégorie", () => {
    expect(activityOf({ categorie: "Prestataire BDG", extra: { activite: "assistance" } })).toBe("assistance");
    expect(activityOf({ categorie: "Prestataire assistance routière", extra: { activite: "autre" } })).toBe("autre");
    expect(activityOf({ categorie: "Prestataires TVA", extra: { activite: "bdg" } })).toBe("bdg");
  });

  it("ignore la casse et les espaces", () => {
    expect(activityOf({ categorie: "", extra: { activite: " BDG " } })).toBe("bdg");
    expect(activityOf({ categorie: "", extra: { activite: "Assistance" } })).toBe("assistance");
  });

  it.each([null, undefined, "texte", 42, [], ["bdg"], {}, { activite: 3 }, { activite: "inconnue" }, { activite: null }, { activite: "" }])("extra illisible %j : on retombe sur la catégorie", (extra) => {
    expect(activityOf({ categorie: "Prestataire BDG", extra })).toBe("bdg");
    expect(activityOf({ categorie: "Fournisseur", extra })).toBe("autre");
  });

  it("explicitActivityOf ne lit que extra.activite", () => {
    expect(explicitActivityOf({ activite: "bdg", autre: 1 })).toBe("bdg");
    expect(explicitActivityOf({ activite: "nimporte" })).toBeNull();
    expect(explicitActivityOf(null)).toBeNull();
  });
});

describe("suggestActivity", () => {
  it("propose assistance / bdg, et rien sinon", () => {
    expect(suggestActivity("Prestataire BDG")).toBe("bdg");
    expect(suggestActivity("Prestataire assistance routière")).toBe("assistance");
    expect(suggestActivity("Prestataires TVA")).toBeNull();
    expect(suggestActivity("")).toBeNull();
  });
});

describe("mergeActivityIntoExtra", () => {
  it("conserve toutes les autres clés", () => {
    const extra = { paiements: [{ date: "2026-01-01", montant: 10, type: "", numero: "" }], groupe: { id: "g1", montant: 5 }, inconnu: { x: 1 }, activite: "bdg" };
    const merged = mergeActivityIntoExtra(extra, "assistance");
    expect(merged).toEqual({ ...extra, activite: "assistance" });
    expect(extra.activite).toBe("bdg");
  });

  it("repart d'un objet vide si extra est illisible", () => {
    for (const extra of [null, undefined, "x", 3, [1, 2]]) expect(mergeActivityIntoExtra(extra, "autre")).toEqual({ activite: "autre" });
  });
});
