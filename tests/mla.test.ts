import { describe, expect, it } from "vitest";
import { computeMla, mlaInvoiceRows, MLA_PARAMS_DEFAUT, paramsForYear, type FleetFile } from "@/features/mla/services/mla-engine";

const fleet: FleetFile = {
  months: [{ sheet: "10 2026", year: 2026, month: 10, count: 100, types: { VP: 100 } }],
  retraits: [
    { immat: "111 222 16", key: "11122216", modele: "", type: "VP", date: "2026-10-05" },
    { immat: "333 444 16", key: "33344416", modele: "", type: "VP", date: "2026-10-20" },
    { immat: "555 666 16", key: "55566616", modele: "", type: "VP", date: "2026-09-02" },
  ],
};
const activity = { byVehicle: { "11122216": [{ num: "1", date: "2026-10-06", prestation: "Remorquage", statut: "" }] }, dossiers: 1 };

describe("facture MLA", () => {
  it("calcule la mensualité et le prix de retrait d'octobre", () => {
    const result = computeMla(fleet, "10 2026", activity);
    expect(result?.annuel).toBe(1_200_000);
    expect(result?.mensualite).toBe(100_000);
    expect(result?.moisRetrait).toBe(3);
    expect(result?.prixRetrait).toBe(3000);
  });

  it("ne garde que les retraits du mois, sinistrés d'abord", () => {
    const result = computeMla(fleet, "10 2026", activity);
    expect(result?.retraits.map((line) => line.key)).toEqual(["11122216", "33344416"]);
    expect(result?.retraits[0]?.sinistre).toBe(true);
    expect(result?.retraits[1]?.sinistre).toBe(false);
  });

  it("renvoie null si le mois est absent", () => {
    expect(computeMla(fleet, "11 2026", activity)).toBeNull();
  });

  it("ne facture que les véhicules sinistrés retenus", () => {
    const result = computeMla(fleet, "10 2026", activity);
    if (!result) throw new Error("calcul absent");
    const rows = mlaInvoiceRows(result, ["11122216", "33344416"]);
    const plates = rows.filter((row) => row.des.includes("111 222") || row.des.includes("333 444"));
    expect(plates).toHaveLength(1);
    expect(rows.some((row) => row.des.startsWith("Immatriculation des véhicules retirés"))).toBe(true);
  });

  it("fige les primes par année", () => {
    const byYear = { "2026": { primeAnnuelle: 12000, primeRetraitMois: 1000 }, "2027": { primeAnnuelle: 13000, primeRetraitMois: 1100 } };
    expect(paramsForYear(byYear, 2026).primeAnnuelle).toBe(12000);
    expect(paramsForYear(byYear, 2027).primeAnnuelle).toBe(13000);
    expect(paramsForYear(byYear, 2028).primeAnnuelle).toBe(13000);
    expect(paramsForYear(byYear, 2025)).toEqual(MLA_PARAMS_DEFAUT);
    expect(paramsForYear({}, 2026)).toEqual(MLA_PARAMS_DEFAUT);
  });
});

describe("totaux de la facture MLA", () => {
  it("affiche mensualité, total retrait, HT, TVA 19 % et TTC", async () => {
    const { computeBilling } = await import("@/features/billing/services/billing-calc");
    const result = computeMla(fleet, "10 2026", activity);
    if (!result) throw new Error("calcul absent");
    const rows = mlaInvoiceRows(result, ["11122216"]) as never;
    const out = computeBilling({ preset: "m_mla", rows, bdgType: "pair" } as never);
    const labels = out.totals.lines.map((line) => line[0]);
    expect(labels).toEqual(["Mensualité 10/12", "Total retrait véhicule", "TOTAL HT", "TVA 19 %", "TOTAL TTC"]);
    expect(out.totals.ht).toBe(103000);
    expect(out.totals.tva).toBe(19570);
    expect(out.totals.ttc).toBe(122570);
  });
});
