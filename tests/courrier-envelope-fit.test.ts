import { describe, expect, it } from "vitest";
import { ENVELOPE_TEXT_WIDTH_MM, MM_PER_PT, fitAddress, fitEnvelopeText, layoutEnvelope, textWidthEm } from "@/features/courrier/lib/envelope-fit";
import { buildDefaultBook } from "@/features/courrier/lib/seed";

const widthOf = (text: string, pt: number): number => textWidthEm(text) * pt * MM_PER_PT;

describe("taille de police adaptative", () => {
  it("un texte court garde la taille maximale sur une ligne", () => {
    const fit = fitEnvelopeText({ text: "ORAN", widthMm: ENVELOPE_TEXT_WIDTH_MM, maxPt: 72, minPt: 30, maxLines: 2 });
    expect(fit).toEqual({ fontPt: 72, lines: ["ORAN"] });
  });

  it("n'augmente jamais au-delà du maximum et ne descend jamais sous le minimum quand tout tient", () => {
    for (const adresse of buildDefaultBook().branches.map((item) => item.adresse)) {
      const fit = fitAddress(adresse);
      expect(fit.fontPt).toBeLessThanOrEqual(72);
      expect(fit.fontPt).toBeGreaterThanOrEqual(30);
    }
  });

  it("plus le texte est long, plus la police est petite (jamais plus grande)", () => {
    const sizes = ["ORAN", "CITE ADMINISTRATIVE ORAN", "CITE ADMINISTRATIVE ILOT 26 ZHUN-USTO ORAN", "ZONE INDUSTRIELLE LE RHUMEL BP 399 - CONSTANTINE 25000 ALGERIE"].map((text) => fitAddress(text).fontPt);
    for (let i = 1; i < sizes.length; i += 1) expect(sizes[i]!).toBeLessThanOrEqual(sizes[i - 1]!);
    expect(sizes[0]).toBe(72);
    expect(sizes[3]).toBeLessThan(sizes[2]!);
  });

  it("aucune ligne ne dépasse la largeur disponible, aucun mot n'est coupé ni perdu, majuscules", () => {
    const text = "Zone Industrielle le Rhumel bp 399 - Constantine 25000 Algerie";
    const fit = fitAddress(text);
    for (const line of fit.lines) expect(widthOf(line, fit.fontPt)).toBeLessThanOrEqual(ENVELOPE_TEXT_WIDTH_MM);
    expect(fit.lines.join(" ")).toBe(text.toLocaleUpperCase("fr"));
  });

  it("l'adresse tient sur deux lignes quand c'est possible, trois au plus sinon", () => {
    expect(fitAddress("CITE ADMINISTRATIVE ILOT 26 ZHUN-USTO ORAN").lines.length).toBeLessThanOrEqual(2);
    expect(fitAddress("ZONE INDUSTRIELLE LE RHUMEL BP 399 - CONSTANTINE 25000 ALGERIE").lines.length).toBeLessThanOrEqual(3);
  });

  it("les lignes sont équilibrées (pas une ligne pleine suivie d'un mot seul)", () => {
    const fit = fitEnvelopeText({ text: "CITE ADMINISTRATIVE ILOT 26 ZHUN-USTO ORAN", widthMm: ENVELOPE_TEXT_WIDTH_MM, maxPt: 72, minPt: 30, maxLines: 2 });
    expect(fit.lines).toHaveLength(2);
    const [first, second] = fit.lines.map((line) => textWidthEm(line));
    expect(Math.min(first!, second!) / Math.max(first!, second!)).toBeGreaterThan(0.6);
  });

  it("une adresse démesurée garde la taille minimale avec plus de lignes, sans rien tronquer", () => {
    const text = Array.from({ length: 40 }, (_, index) => `RUE${index}`).join(" ");
    const fit = fitEnvelopeText({ text, widthMm: ENVELOPE_TEXT_WIDTH_MM, maxPt: 72, minPt: 30, maxLines: 2 });
    expect(fit.fontPt).toBe(30);
    expect(fit.lines.length).toBeGreaterThan(2);
    expect(fit.lines.join(" ")).toBe(text);
  });

  it("texte vide : aucune ligne ; accents mesurés comme leur lettre de base", () => {
    expect(fitEnvelopeText({ text: "   ", widthMm: 200, maxPt: 48, minPt: 24, maxLines: 1 }).lines).toEqual([]);
    expect(textWidthEm("É")).toBe(textWidthEm("E"));
  });
});

describe("mise en page complète de l'étiquette", () => {
  const book = buildDefaultBook();

  it("modèle Oran : nom, adresse et téléphone aux tailles maximales ou réduites, jamais supérieures à 48 / 72 / 48", () => {
    const oran = book.branches.find((item) => item.id === "caar-oran-400")!;
    const layout = layoutEnvelope(oran);
    expect(layout.nom.fontPt).toBeLessThanOrEqual(48);
    expect(layout.adresse.fontPt).toBeLessThanOrEqual(72);
    expect(layout.telephones.fontPt).toBeLessThanOrEqual(48);
    expect(layout.contact).toBeNull();
    expect(layout.nom.lines).toEqual(["SUCCURSALE CAAR ORAN 400"]);
  });

  it("une fiche avec contact donne la ligne « À l'attention de … »", () => {
    const alger2 = book.branches.find((item) => item.id === "caat-alger-2")!;
    expect(layoutEnvelope(alger2).contact?.lines.join(" ")).toBe("À L'ATTENTION DE MR. AMEZIANE MAKHLOUF");
  });

  it("toutes les fiches de départ tiennent dans la largeur, ligne par ligne", () => {
    for (const item of book.branches) {
      const layout = layoutEnvelope(item);
      for (const block of [layout.nom, layout.adresse, layout.telephones, layout.contact]) {
        if (!block) continue;
        for (const line of block.lines) expect(widthOf(line, block.fontPt)).toBeLessThanOrEqual(ENVELOPE_TEXT_WIDTH_MM);
      }
    }
  });

  it("Alger 3 sans téléphone : aucun bloc téléphone", () => {
    const alger3 = book.branches.find((item) => item.id === "caat-alger-3")!;
    expect(layoutEnvelope(alger3).telephones.lines).toEqual([]);
  });
});
