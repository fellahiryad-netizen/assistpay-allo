import { describe, expect, it } from "vitest";
import { gamLineToBillingRow, splitGamFile } from "@/features/billing/lib/gam-split";
import type { SheetCell } from "@/lib/spreadsheet";

const HEAD: SheetCell[] = ["N°Dossier", "Matricule", "Nom Client", "Agence", "Préstation", "Produit", "Date", "N° sinistre", "Prix"];
const line = (dos: string, sin: string, prix: SheetCell): SheetCell[] => [dos, "123-45", "CLIENT", "AGENCE", "glass", "PARE BRISE", "01/10/2026", sin, prix];
const sheet = (data: SheetCell[][], total: SheetCell | null = null): SheetCell[][] => [
  ["EURL ALLO ASSISTANCE"],
  ["Date: 18/11/2026"],
  ["N°: GAM0011/2026"],
  HEAD,
  ...data,
  [null],
  ...(total === null ? [] : [[null, null, null, null, null, null, null, "Total HT", total] as SheetCell[]]),
];

describe("splitGamFile", () => {
  it("sépare conventionnel (10 chiffres) et Takaful (12 chiffres) et contrôle le total", () => {
    const result = splitGamFile(sheet([line("B1", "2506021463", "25 300,00"), line("B2", "260791000806", 52800), line("B3", "2511025607", 74800)], "152 900,00 DA"));
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.conv).toHaveLength(2);
    expect(result.data.takaful).toHaveLength(1);
    expect(result.data.convHt).toBe(100100);
    expect(result.data.takafulHt).toBe(52800);
    expect(result.data.fileNum).toBe("GAM0011/2026");
    expect(result.data.fileDate).toBe("18/11/2026");
    expect(result.data.fileTotalHt).toBe(152900);
    expect(result.data.controlOk).toBe(true);
  });
  it("classe en Takaful un sinistre avec lettres, symboles et espaces dont les chiffres font 12", () => {
    const result = splitGamFile(sheet([line("B1", "TK/26-07 9100 0806", 1000)]));
    expect(result.success && result.data.takaful[0]?.sin).toBe("260791000806");
  });
  it("met à part un sinistre de 11 chiffres ou absent", () => {
    const result = splitGamFile(sheet([line("B1", "25060214631", 1000), line("B2", "", 500)], "1 500,00"));
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.unknown.map((entry) => entry.dos)).toEqual(["B1", "B2"]);
    expect(result.data.controlOk).toBe(false);
  });
  it("signale un écart avec le total du fichier", () => {
    const result = splitGamFile(sheet([line("B1", "2506021463", 1000)], "2 000,00 DA"));
    expect(result.success && result.data.controlOk).toBe(false);
  });
  it("signale un dossier présent deux fois sans l'écarter", () => {
    const result = splitGamFile(sheet([line("B1", "2506021463", 1000), line("B1", "2506021463", 1000)]));
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.conv).toHaveLength(2);
    expect(result.data.duplicates).toEqual([{ dos: "B1", rows: [5, 6] }]);
  });
  it("échoue sans en-tête", () => {
    expect(splitGamFile([["rien"], ["à lire"]]).success).toBe(false);
  });
  it("produit une ligne du modèle bdggam", () => {
    const result = splitGamFile(sheet([line("B1", "2506021463", "25 300,00")]));
    if (!result.success || !result.data.conv[0]) throw new Error("fichier non lu");
    expect(gamLineToBillingRow(result.data.conv[0])).toMatchObject({ dos: "B1", sin: "2506021463", prix: "25300.00", pres: "PARE BRISE" });
  });
});
