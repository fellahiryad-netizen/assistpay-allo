import { describe, expect, it } from "vitest";
import { COMPANY_LOGOS, groupByCompany, markedCompany, sigleParts, sigleText, subtotalLabel } from "@/features/courrier/lib/company";
import { buildEditorLines } from "@/features/courrier/lib/bordereau";
import { buildDefaultBook } from "@/features/courrier/lib/seed";
import { createEnvoiIn } from "@/features/courrier/lib/envois";
import { existsSync } from "node:fs";
import { join } from "node:path";

const line = (compagnie: string, designation: string, qnt = 1) => ({ compagnie, designation, qnt });

describe("sigle de la compagnie", () => {
  it("CaaT et CaaR : seule la dernière lettre change", () => {
    expect(sigleParts("CAAT")).toEqual({ first: "C", small: "aa", last: "T" });
    expect(sigleParts("CAAR")).toEqual({ first: "C", small: "aa", last: "R" });
    expect(sigleText("CAAT")).toBe("CaaT");
    expect(sigleText("CAAR")).toBe("CaaR");
  });

  it("repère seulement pour CAAT et CAAR", () => {
    expect(markedCompany("CAAT")).toBe("CAAT");
    expect(markedCompany("CAAR")).toBe("CAAR");
    for (const other of ["", "GAM", "caat", null, undefined]) expect(markedCompany(other)).toBeNull();
  });

  it("les deux logos existent dans public/partenaires", () => {
    for (const path of Object.values(COMPANY_LOGOS)) expect(existsSync(join(process.cwd(), "public", path))).toBe(true);
  });

  it("sous-total : singulier et pluriel", () => {
    expect(subtotalLabel("CAAT", 3)).toBe("CaaT : 3 plis");
    expect(subtotalLabel("CAAR", 1)).toBe("CaaR : 1 pli");
  });
});

describe("regroupement par compagnie", () => {
  const mixed = [line("CAAR", "R1"), line("CAAT", "T1"), line("CAAR", "R2", 2), line("", "Libre"), line("CAAT", "T2")];

  it("mixte : CAAT puis CAAR puis lignes sans repère, ordre conservé dans chaque groupe", () => {
    const groups = groupByCompany(mixed);
    expect(groups.map((g) => g.compagnie)).toEqual(["CAAT", "CAAR", ""]);
    expect(groups.map((g) => g.items.map((i) => i.designation))).toEqual([["T1", "T2"], ["R1", "R2"], ["Libre"]]);
  });

  it("une seule compagnie : ordre de la sélection gardé, un seul groupe", () => {
    const groups = groupByCompany([line("CAAR", "B"), line("CAAR", "A")]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.items.map((i) => i.designation)).toEqual(["B", "A"]);
    expect(groupByCompany([line("", "x"), line("GAM", "y")])).toHaveLength(1);
    expect(groupByCompany([])).toEqual([]);
  });

  it("la liste d'origine n'est pas modifiée ; tous les éléments sont conservés", () => {
    const copy = structuredClone(mixed);
    const groups = groupByCompany(mixed);
    expect(mixed).toEqual(copy);
    expect(groups.flatMap((g) => g.items)).toHaveLength(mixed.length);
  });

  it("sous-totaux par groupe + total général cohérents", () => {
    const groups = groupByCompany(mixed);
    const sums = groups.map((g) => g.items.reduce((s, i) => s + i.qnt, 0));
    expect(sums).toEqual([2, 3, 1]);
    expect(sums.reduce((a, b) => a + b, 0)).toBe(mixed.reduce((s, i) => s + i.qnt, 0));
  });
});

describe("bordereau enregistré : données et numérotation inchangées", () => {
  it("l'ordre de sélection est enregistré tel quel et le numéro BE reste séquentiel", () => {
    const { branches } = buildDefaultBook();
    const caar = branches.find((b) => b.compagnie === "CAAR");
    const caat = branches.find((b) => b.compagnie === "CAAT");
    if (!caar || !caat) throw new Error("jeu de départ incomplet");
    const lignes = buildEditorLines([caar, caat]);
    expect(lignes.map((l) => l.compagnie)).toEqual(["CAAR", "CAAT"]);
    const created = createEnvoiIn({ seq: 0, items: [] }, { annee: 2026, creeLe: "2026-11-25T09:00:00.000Z", creePar: "Test", creeParId: "u", date: "2026-11-25", ramasseur: "", remarque: "", lignes });
    if (!created.ok) throw new Error(created.error);
    expect(created.value.numero).toBe("BE-2026-001");
    expect(created.value.lignes.map((l) => l.compagnie)).toEqual(["CAAR", "CAAT"]);
    expect(created.value.total).toBe(2);
    expect(groupByCompany(created.value.lignes).map((g) => g.compagnie)).toEqual(["CAAT", "CAAR"]);
  });
});

describe("étiquette : nom complet et hauteur disponible", () => {
  it("noms complets : ceux des logos du dépôt", async () => {
    const { COMPANY_NAMES } = await import("@/features/courrier/lib/company");
    expect(COMPANY_NAMES.CAAR).toBe("COMPAGNIE ALGÉRIENNE D'ASSURANCE ET DE RÉASSURANCE");
    expect(COMPANY_NAMES.CAAT).toBe("COMPAGNIE ALGÉRIENNE DES ASSURANCES");
  });

  it("réduction proportionnelle seulement si ça ne tient pas, sans changer les lignes", async () => {
    const { layoutEnvelope, layoutHeightMm, shrinkLayoutToHeight } = await import("@/features/courrier/lib/envelope-fit");
    const short = layoutEnvelope({ nom: "SUCCURSALE CAAT ALGER 3", adresse: "Résidence Chaabani Hydra Alger", telephones: "", contact: "" });
    expect(shrinkLayoutToHeight(short, 500)).toBe(short);
    const long = layoutEnvelope({ nom: "SUCCURSALE CAAR CONSTANTINE 500", adresse: "ZONE INDUSTRIELLE LE RHUMEL BP 399 25000 CONSTANTINE ALGERIE ROUTE NATIONALE", telephones: "031 00 00 00 / 031 11 11 11", contact: "Madame Fatima Benali" });
    const fitted = shrinkLayoutToHeight(long, 78);
    expect(layoutHeightMm(fitted)).toBeLessThanOrEqual(78 + 1);
    expect(fitted.adresse.lines).toEqual(long.adresse.lines);
    expect(fitted.adresse.fontPt).toBeLessThan(long.adresse.fontPt);
  });
});
