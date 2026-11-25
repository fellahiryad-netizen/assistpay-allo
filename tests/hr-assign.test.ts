import { describe, expect, it } from "vitest";
import { expectedLineSens, fillFromLine, rankCandidateLines, type HrCandidateLine } from "@/features/hr/lib/hr-assign";

const line = (id: string, montant: number, date: string, sens: "DEBIT" | "CREDIT" = "DEBIT", type = "VIRMT", numero = ""): HrCandidateLine => ({ id, date, libelle: id, numero, montant, sens, type });

describe("hr-assign", () => {
  it("un paiement attend un débit, un retour un crédit", () => {
    expect(expectedLineSens("PAIEMENT")).toBe("DEBIT");
    expect(expectedLineSens("RETOUR")).toBe("CREDIT");
  });
  it("classe le montant exact d'abord, écarte les autres sens et les écarts de plus de 10 %", () => {
    const ranked = rankCandidateLines({ sens: "PAIEMENT", montant: 1000, date: "2026-08-20" }, [
      line("proche", 1004, "2026-08-21"),
      line("exact-loin", 1000, "2026-05-01"),
      line("credit", 1000, "2026-08-20", "CREDIT"),
      line("trop-loin", 1200, "2026-08-20"),
    ]);
    expect(ranked.map((item) => item.id)).toEqual(["exact-loin", "proche"]);
    expect(ranked[0]?.exact).toBe(true);
    expect(ranked[1]?.ecart).toBe(4);
  });
  it("sans date, les jours restent inconnus", () => {
    expect(rankCandidateLines({ sens: "PAIEMENT", montant: 50, date: null }, [line("a", 50, "2026-01-01")])[0]?.jours).toBeNull();
  });
  it("complète seulement les champs vides", () => {
    expect(fillFromLine({ date: null, mode: "", cheque: "" }, { date: "2026-02-19", numero: "TL-6724744", type: "CHEQUE" })).toEqual({ date: "2026-02-19", mode: "CHEQUE", cheque: "TL-6724744" });
    expect(fillFromLine({ date: "2026-02-18", mode: "VIRMT", cheque: "" }, { date: "2026-02-19", numero: "X", type: "CHEQUE" })).toEqual({});
  });
});
