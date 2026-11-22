import { describe, expect, it } from "vitest";
import { agingBuckets, LEVEL_WORDS, topPayees, withExact } from "@/features/treasury/lib/deck";
import { pdfText } from "@/features/treasury/lib/pdf-text";
import type { PayableItem } from "@/features/treasury/lib/payables";

const item = (beneficiaire: string, montant: number, ageDays: number | null): PayableItem => ({ id: `${beneficiaire}${montant}`, date: "2026-11-22", beneficiaire, libelle: "", nature: "assistance", montant, source: "facture", certain: true, ageDays });

describe("contenu de la présentation PDF", () => {
  it("millions arrondis seulement avec le montant exact à côté", () => {
    expect(withExact(41_378_405.18)).toMatch(/^41,4 M DA \(41.378.405,18 DA\)$/);
    expect(withExact(850_000)).toMatch(/^850.000,00 DA$/);
  });
  it("les niveaux sont écrits en toutes lettres", () => {
    expect(LEVEL_WORDS).toEqual({ vert: "VERT", orange: "ORANGE", rouge: "ROUGE", indetermine: "INDÉTERMINÉ" });
  });
  it("plus gros prestataires : regroupés sans tenir compte de la casse, triés, limités", () => {
    const rows = [item("Alpha", 100, 5), item("ALPHA", 50, 40), item("Beta", 120, null), ...Array.from({ length: 10 }, (_, i) => item(`P${i}`, 10 + i, 1))];
    const top = topPayees(rows, 3);
    expect(top.map((p) => [p.name, p.total, p.count, p.oldestDays])).toEqual([["Alpha", 150, 2, 40], ["Beta", 120, 1, null], ["P9", 19, 1, 1]]);
  });
  it("ancienneté : tranches et dates inconnues", () => {
    const aging = agingBuckets([item("a", 10, 5), item("b", 20, 45), item("c", 30, 120), item("d", 5, null)]);
    expect(aging).toEqual([
      { label: "30 jours ou moins", total: 10, count: 1 },
      { label: "31 à 60 jours", total: 20, count: 1 },
      { label: "61 à 90 jours", total: 0, count: 0 },
      { label: "Plus de 90 jours", total: 30, count: 1 },
      { label: "Date de facture inconnue", total: 5, count: 1 },
    ]);
  });
  it("texte PDF : caractères hors latin-1 remplacés, espaces fines normalisées", () => {
    expect(pdfText("22 752 053,00 DA → − 5 — « é »")).toBe("22 752 053,00 DA -> - 5 - « é »");
    expect(pdfText("日本")).toBe("??");
  });
});
