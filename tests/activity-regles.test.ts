import { describe, expect, it } from "vitest";
import { activityOf, activityToStore, buildActivityHints, needsActivityHints } from "@/features/invoices/lib/activity";

describe("règles de déduction complémentaires", () => {
  it("« Allo Assistance » dans le tiers ne donne pas l'activité assistance", () => {
    expect(activityOf({ categorie: "", tiers: "EURL ALLO ASSISTANCE" })).toBe("autre");
    expect(activityOf({ categorie: "", tiers: "Allo  Assistance Chéraga" })).toBe("autre");
  });
  it("mais un autre tiers « assistance » reste assistance", () => {
    expect(activityOf({ categorie: "", tiers: "Home assistance" })).toBe("assistance");
    expect(activityOf({ categorie: "Prestataire Assistance", tiers: "Home assistance" })).toBe("assistance");
  });
  it("accepte la faute « assistane »", () => {
    expect(activityOf({ categorie: "Prestataire assistane routiere" })).toBe("assistance");
  });
});

describe("catégories ambiguës (TVA, ABG SERVICE) : activité majoritaire du tiers", () => {
  const rows = [
    { tiers: "Vitres B", categorie: "Prestataire BDG", extra: {} },
    { tiers: "Vitres B", categorie: "prestataires BDG", extra: null },
    { tiers: "Vitres B", categorie: "Prestataire assistance", extra: {} },
    { tiers: "Garage A", categorie: "Prestataire assistance routière", extra: {} },
    { tiers: "Mixte", categorie: "Prestataire BDG", extra: {} },
    { tiers: "Mixte", categorie: "Prestataire assistance", extra: {} },
    { tiers: "Neutre", categorie: "Prestataires TVA", extra: {} },
    { tiers: "Garage C", categorie: "Fournisseur", extra: { activite: "bdg" } },
  ];
  const hints = buildActivityHints(rows);

  it("classe selon le tiers", () => {
    expect(activityOf({ categorie: "Prestataires TVA", tiers: "vitres b" }, hints)).toBe("bdg");
    expect(activityOf({ categorie: "ABG SERVICE", tiers: "Garage A" }, hints)).toBe("assistance");
    expect(activityOf({ categorie: "Prestataires TVA", tiers: "Garage C" }, hints)).toBe("bdg");
  });
  it("égalité, tiers inconnu ou sans indice : autre", () => {
    expect(activityOf({ categorie: "Prestataires TVA", tiers: "Mixte" }, hints)).toBe("autre");
    expect(activityOf({ categorie: "Prestataires TVA", tiers: "Neutre" }, hints)).toBe("autre");
    expect(activityOf({ categorie: "ABG SERVICE", tiers: "Inconnu" }, hints)).toBe("autre");
    expect(activityOf({ categorie: "ABG SERVICE", tiers: "Garage A" })).toBe("autre");
  });
  it("les autres catégories sans mot-clé ne sont jamais déduites du tiers", () => {
    expect(activityOf({ categorie: "Prestataire TPA", tiers: "Garage A" }, hints)).toBe("autre");
    expect(activityOf({ categorie: "Fournisseur", tiers: "Vitres B" }, hints)).toBe("autre");
  });
  it("l'activité explicite reste prioritaire", () => {
    expect(activityOf({ categorie: "Prestataires TVA", tiers: "Vitres B", extra: { activite: "autre" } }, hints)).toBe("autre");
  });
  it("needsActivityHints", () => {
    expect(needsActivityHints({ categorie: "Prestataires TVA", extra: {} })).toBe(true);
    expect(needsActivityHints({ categorie: "abg service", extra: null })).toBe(true);
    expect(needsActivityHints({ categorie: "Prestataires TVA", extra: { activite: "bdg" } })).toBe(false);
    expect(needsActivityHints({ categorie: "Prestataire BDG", extra: {} })).toBe(false);
  });
});

describe("activityToStore : ne pas figer une activité déduite", () => {
  it("rien à écrire si le choix égale la déduction et qu'il n'y a pas d'activité explicite", () => {
    expect(activityToStore("bdg", false, "bdg")).toBeNull();
  });
  it("écrit si le choix diffère de la déduction", () => {
    expect(activityToStore("assistance", false, "bdg")).toBe("assistance");
  });
  it("écrit si la facture avait déjà une activité explicite", () => {
    expect(activityToStore("bdg", true, "bdg")).toBe("bdg");
  });
});
