import { describe, expect, it } from "vitest";
import { detectHrAnomalies, inconsistentBeneficiary, mergeValidations, parseValidations, removeValidation, type HrAnomalyEntry, type HrAnomalyValidation } from "@/features/hr/lib/hr-anomalies";

const base: Omit<HrAnomalyEntry, "id"> = { nature: "G50", sens: "PAIEMENT", beneficiaire: "Receveur des impôts", mois: "2026-09", date: "2026-10-19", montant: 13_916_005, cheque: "", libelle: "G50 09-2026", monthKey: "2026-09" };
const v = (key: string): HrAnomalyValidation => ({ key, motif: "", par: "RH", parId: "u1", le: "2026-11-19T10:00:00.000Z" });

describe("ordre des écritures", () => {
  const entries: HrAnomalyEntry[] = [
    { ...base, id: "b", date: "2026-11-04", mois: "2026-11", monthKey: "2026-09", libelle: "G50 SEPTEMBRE", beneficiaire: "G50 SEPTEMBRE", cheque: "TL-7064740" },
    { ...base, id: "a" },
    { ...base, id: "c", nature: "Salaire", beneficiaire: "Ahmed", montant: 80_000, libelle: "", monthKey: "2026-10" },
  ];

  it("mêmes clés et mêmes messages quel que soit l'ordre de chargement", () => {
    const view = (list: HrAnomalyEntry[]): string[] => detectHrAnomalies(list).map((item) => `${item.key}|${item.message}`).sort();
    const direct = view(entries);
    expect(direct.length).toBeGreaterThan(0);
    expect(view([...entries].reverse())).toEqual(direct);
    expect(view([entries[1]!, entries[2]!, entries[0]!])).toEqual(direct);
  });

  it("la clé d'un doublon cite les identifiants triés", () => {
    const doublon = detectHrAnomalies(entries).find((item) => item.kind === "doublon");
    expect(doublon?.entryIds).toEqual(["a", "b"]);
    expect(doublon?.key.startsWith("doublon:a+b:")).toBe(true);
  });
});

describe("bénéficiaire incohérent : faux positifs CNAS", () => {
  it("n'est pas signalé pour une agence ou un organisme CNAS", () => {
    expect(inconsistentBeneficiary({ nature: "CNAS", beneficiaire: "CNAS KOLEA" })).toBeNull();
    expect(inconsistentBeneficiary({ nature: "CNAS", beneficiaire: "CNAS" })).toBeNull();
    expect(inconsistentBeneficiary({ nature: "CASNOS", beneficiaire: "CASNOS" })).toBeNull();
  });
  it("reste signalé pour « Salaires du personnel » et pour « G50 SEPTEMBRE »", () => {
    expect(inconsistentBeneficiary({ nature: "CNAS", beneficiaire: "Salaires du personnel" })).not.toBeNull();
    expect(inconsistentBeneficiary({ nature: "G50", beneficiaire: "Salaires du personnel" })).not.toBeNull();
    expect(inconsistentBeneficiary({ nature: "G50", beneficiaire: "G50 SEPTEMBRE" })).not.toBeNull();
    expect(inconsistentBeneficiary({ nature: "IRG", beneficiaire: "IRG octobre" })).not.toBeNull();
    expect(inconsistentBeneficiary({ nature: "G50", beneficiaire: "Receveur des impôts" })).toBeNull();
  });
});

describe("validations : lecture, purge et plafond", () => {
  it("lecture tolérante", () => {
    expect(parseValidations(null)).toEqual([]);
    expect(parseValidations({ items: "x" })).toEqual([]);
    expect(parseValidations({ items: [null, 3, { key: "" }, { key: "k1", motif: 5 }, { key: "k2", motif: "ok", par: "A", parId: "1", le: "d" }] })).toEqual([
      { key: "k1", motif: "", par: "", parId: "", le: "" },
      { key: "k2", motif: "ok", par: "A", parId: "1", le: "d" },
    ]);
  });

  it("purge les validations orphelines à chaque ajout et remplace une clé déjà validée", () => {
    const result = mergeValidations([v("vivante"), v("orpheline"), v("dup")], [{ ...v("dup"), motif: "neuf" }, v("nouvelle")], ["vivante", "dup", "nouvelle"]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.items.map((item) => item.key)).toEqual(["vivante", "dup", "nouvelle"]);
      expect(result.items.find((item) => item.key === "dup")?.motif).toBe("neuf");
    }
  });

  it("refuse au-delà du plafond sans rien écraser, après avoir purgé les orphelines", () => {
    const keys = Array.from({ length: 5 }, (_, i) => `k${i}`);
    const refus = mergeValidations(keys.slice(0, 3).map(v), keys.slice(3).map(v), keys, 4);
    expect(refus.ok).toBe(false);
    if (!refus.ok) expect(refus.error).toContain("Rétablissez");
    // Avec des orphelines, la purge libère de la place.
    const passe = mergeValidations(["o1", "o2", "k0"].map(v), ["k1", "k2"].map(v), ["k0", "k1", "k2"], 4);
    expect(passe.ok).toBe(true);
  });

  it("le rétablissement retire la clé et purge les orphelines", () => {
    const result = removeValidation([v("a"), v("b"), v("orpheline")], "a", ["a", "b"]);
    expect(result.ok && result.items.map((item) => item.key)).toEqual(["b"]);
  });
});
