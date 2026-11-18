import { describe, expect, it } from "vitest";
import { buildGamDetailSheets } from "@/features/billing/services/gam-detail-export";
import type { BillingDraft } from "@/features/billing/types";

const draft = (rows: Array<Record<string, string>>): BillingDraft => ({
  preset: "g_bdgab_t",
  client: "GAM",
  cli: { nom: "", adresse: "", tel: "", rc: "", nif: "", nis: "", ai: "" },
  num: "18/2026 AB",
  num2: "",
  date: "2026-11-18",
  objet: "",
  per: "2026-10",
  perTxt: "OCTOBRE 2026",
  succ: "",
  bc: "",
  origine: "",
  destination: "",
  details: {},
  notes: "",
  rows,
  bdgType: "pair",
  caarProd: "",
  fromPrev: "",
});

const line = (n: number, prix: string, sin = "260791000806"): Record<string, string> => ({ dos: `B26${n}`, mat: "1-2-3", nom: "AL SALAM BANK", ag: "RASSOUL", pres: "PARE BRISE (Adaptable)", dt: "29/09/2026", sin, prix });

describe("buildGamDetailSheets", () => {
  const sheets = buildGamDetailSheets([
    { kind: "CONV", draft: draft([line(1, "25 300,00", "2506021463"), line(2, "52800", "2510021504")]) },
    { kind: "TAKAFUL", draft: draft([line(3, "52800")]) },
  ]);
  const cell = (sheet: number, row: number, col: number) => sheets[sheet]?.rows[row - 1]?.[col];

  it("fait une feuille par facture, nommée CONV / TAKAFUL", () => {
    expect(sheets.map((sheet) => sheet.name)).toEqual(["CONV", "TAKAFUL"]);
    expect(cell(0, 12, 0)).toBe("Facture  CONVENTIONNEL");
    expect(cell(1, 12, 0)).toBe("Facture  TAKAFUL");
  });
  it("reprend l'en-tête, le tableau et le n° de sinistre numérique", () => {
    expect(cell(0, 1, 0)).toBe("EURL ALLO ASSISTANCE");
    expect(cell(0, 2, 4)).toBe("Entreprise: GENERALE ASSURANCE MEDITERRANEENNE");
    expect(cell(0, 14, 7)).toBe("N° sinistre");
    expect(cell(0, 15, 7)).toBe(2506021463);
    expect(cell(0, 15, 8)).toBe(25300);
  });
  it("calcule le total HT, la TVA 19 % et le TTC avec les formules du modèle", () => {
    // 2 lignes : données lignes 15-16, totaux en ligne 18.
    expect(cell(0, 18, 7)).toBe("Total HT");
    expect(cell(0, 18, 8)).toEqual({ f: "SUM(I15:I16)", v: 78100 });
    expect(cell(0, 19, 8)).toEqual({ f: "+I18*0.19", v: 14839 });
    expect(cell(0, 20, 8)).toEqual({ f: "SUM(I18:I19)", v: 92939 });
    expect(cell(0, 23, 0)).toMatch(/dinars/i);
    expect(cell(1, 17, 8)).toEqual({ f: "SUM(I15:I15)", v: 52800 });
  });
});
