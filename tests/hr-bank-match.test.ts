import { describe, expect, it } from "vitest";
import { bankChequeNumbers, matchHrToBank, strongHrMatches, type HrBankEntry, type HrBankLine } from "@/features/hr/lib/hr-bank-match";
import { anomalyKey, detectHrAnomalies, inconsistentBeneficiary, partitionAnomalies, shortHash } from "@/features/hr/lib/hr-anomalies";

const entry = (patch: Partial<HrBankEntry>): HrBankEntry => ({ id: "e1", sens: "PAIEMENT", mode: "CHEQUE", cheque: "", montant: 13_916_005, date: "2026-11-04", ...patch });
const line = (patch: Partial<HrBankLine>): HrBankLine => ({ id: "l1", date: "2026-11-05", libelle: "", montant: 13_916_005, sens: "DEBIT", ...patch });

describe("numéros de chèque du libellé bancaire", () => {
  it("lit « PAIEMENT CHEQUE N° TL-7064740 »", () => {
    expect(bankChequeNumbers("PAIEMENT CHEQUE N° TL-7064740")).toEqual(["7064740"]);
    expect(bankChequeNumbers("PAIEMENT CHEQUE N° 0007064740 DU 04/11/2026")).toEqual(["7064740"]);
  });
});

describe("rapprochement RH et relevé", () => {
  it("fort : chèque 7064740 saisi à la main contre TL-7064740 du relevé", () => {
    const matches = matchHrToBank([entry({ cheque: "7064740" })], [line({ libelle: "PAIEMENT CHEQUE N° TL-7064740", date: "2026-11-20" })]);
    expect(matches.get("e1")).toMatchObject({ lineId: "l1", level: "fort" });
  });

  it("moyen : montant identique et date à ±5 jours (virement)", () => {
    const matches = matchHrToBank([entry({ mode: "VIRMT" })], [line({ libelle: "VIREMENT", date: "2026-11-08" })]);
    expect(matches.get("e1")?.level).toBe("moyen");
  });

  it("une écriture transférée depuis une facture (mode « VIREMENT ») est aussi rapprochée", () => {
    expect(matchHrToBank([entry({ mode: "VIREMENT" })], [line({ date: "2026-11-06" })]).get("e1")?.level).toBe("moyen");
  });

  it("faible : montant seul, plus loin dans le temps", () => {
    const matches = matchHrToBank([entry({ mode: "VIRMT" })], [line({ date: "2026-12-20" })]);
    expect(matches.get("e1")?.level).toBe("faible");
  });

  it("non trouvé : montant différent, ligne de crédit, ou mode autre", () => {
    expect(matchHrToBank([entry({ cheque: "7064740" })], [line({ libelle: "CHEQUE TL-7064740", montant: 1 })]).size).toBe(0);
    expect(matchHrToBank([entry({})], [line({ sens: "CREDIT" })]).size).toBe(0);
    expect(matchHrToBank([entry({ mode: "" })], [line({})]).size).toBe(0);
    expect(matchHrToBank([entry({ sens: "RETOUR" })], [line({})]).size).toBe(0);
  });

  it("deux chèques de même montant le même jour : chacun s'apparie à sa propre ligne", () => {
    const a = entry({ id: "a", cheque: "7064740", montant: 75_468, date: "2026-11-04" });
    const b = entry({ id: "b", cheque: "7064741", montant: 75_468, date: "2026-11-04" });
    // Lignes volontairement dans l'ordre inverse.
    const lines = [line({ id: "lb", libelle: "PAIEMENT CHEQUE N° TL-7064741", montant: 75_468, date: "2026-11-04" }), line({ id: "la", libelle: "PAIEMENT CHEQUE N° TL-7064740", montant: 75_468, date: "2026-11-04" })];
    const matches = matchHrToBank([a, b], lines);
    expect(matches.get("a")).toMatchObject({ lineId: "la", level: "fort" });
    expect(matches.get("b")).toMatchObject({ lineId: "lb", level: "fort" });
  });

  it("une ligne déjà affectée à une facture n'est pas proposée en moyen ou faible, mais le fort reste possible", () => {
    const affectee = line({ refs: ["inv-1:tout"], libelle: "VIREMENT" });
    expect(matchHrToBank([entry({ mode: "VIRMT" })], [affectee]).size).toBe(0);
    expect(matchHrToBank([entry({ cheque: "7064740" })], [{ ...affectee, libelle: "CHEQUE TL-7064740" }]).get("e1")?.level).toBe("fort");
  });

  it("une ligne ne sert qu'à une seule écriture", () => {
    const matches = matchHrToBank([entry({ id: "a", mode: "VIRMT" }), entry({ id: "b", mode: "VIRMT" })], [line({})]);
    expect(matches.size).toBe(1);
  });

  it("une ligne déjà liée (« rh:… ») à l'écriture est un rapprochement fort", () => {
    const matches = matchHrToBank([entry({ legacyId: "rh-1", mode: "VIRMT", date: null })], [line({ refs: ["rh:rh-1"], date: "2026-02-01" })]);
    expect(matches.get("e1")?.level).toBe("fort");
  });
});

describe("analyse du relevé : règle forte seule", () => {
  it("classe la ligne TL-7064740 comme déjà saisie, sans rapprocher le chèque voisin de même montant", () => {
    const entries = [entry({ id: "a", cheque: "7064740", montant: 75_468 }), entry({ id: "b", cheque: "7064741", montant: 75_468 })];
    const lines = [line({ id: "l2", libelle: "PAIEMENT CHEQUE N° TL-7064741", montant: 75_468 }), line({ id: "l1", libelle: "PAIEMENT CHEQUE N° TL-7064740", montant: 75_468 }), line({ id: "l3", libelle: "PAIEMENT CHEQUE N° TL-9999999", montant: 75_468 })];
    const result = strongHrMatches(lines, entries);
    expect(result.get("l1")).toBe("a");
    expect(result.get("l2")).toBe("b");
    expect(result.has("l3")).toBe(false);
  });
});

describe("anomalies", () => {
  const base = { sens: "PAIEMENT" as const, mois: "2026-09", date: "2026-10-19", cheque: "", libelle: "", monthKey: "2026-10" };

  it("bénéficiaire incohérent avec la nature", () => {
    expect(inconsistentBeneficiary({ nature: "G50", beneficiaire: "Salaires du personnel" })).not.toBeNull();
    expect(inconsistentBeneficiary({ nature: "G50", beneficiaire: "G50 SEPTEMBRE" })).not.toBeNull();
    expect(inconsistentBeneficiary({ nature: "G50", beneficiaire: "Receveur des impôts" })).toBeNull();
    expect(inconsistentBeneficiary({ nature: "Salaire", beneficiaire: "Salaires du personnel" })).toBeNull();
  });

  it("l'écart de période n'est signalé que pour G50, IRG et IBS", () => {
    const list = detectHrAnomalies([{ ...base, id: "1", nature: "CNAS", beneficiaire: "CNAS", montant: 5, libelle: "CNAS septembre", monthKey: "2026-10" }]);
    expect(list.filter((a) => a.kind === "periode")).toHaveLength(0);
  });

  it("liste doublon, bénéficiaire et période", () => {
    const list = detectHrAnomalies([
      { ...base, id: "1", nature: "G50", beneficiaire: "Receveur des impôts", montant: 13_916_005, libelle: "G50 09-2026" },
      { ...base, id: "2", nature: "G50", beneficiaire: "G50 SEPTEMBRE", montant: 13_916_005, date: "2026-11-04", monthKey: "2026-11", libelle: "G50 SEPTEMBRE" },
    ]);
    expect(list.filter((a) => a.kind === "doublon")).toHaveLength(1);
    expect(list.filter((a) => a.kind === "beneficiaire")).toHaveLength(1);
    expect(list.filter((a) => a.kind === "periode")).toHaveLength(2);
  });

  it("aucune anomalie pour deux salaires identiques à des employés différents", () => {
    const list = detectHrAnomalies([
      { ...base, id: "1", nature: "Salaire", beneficiaire: "Ahmed Benali", montant: 80_000, monthKey: "2026-10", mois: "2026-10" },
      { ...base, id: "2", nature: "Salaire", beneficiaire: "Karim Haddad", montant: 80_000, monthKey: "2026-10", mois: "2026-10" },
    ]);
    expect(list).toHaveLength(0);
  });
});

describe("clé stable et validation des anomalies", () => {
  const base = { sens: "PAIEMENT" as const, mois: "2026-09", date: "2026-10-19", cheque: "", libelle: "G50 09-2026", monthKey: "2026-10", nature: "G50" };
  const salaires = { ...base, id: "b", beneficiaire: "Salaires du personnel", montant: 100 };

  it("la clé est stable et ne dépend pas de l'ordre des identifiants", () => {
    const message = "Doublon probable : test";
    expect(anomalyKey({ kind: "doublon", entryIds: ["b", "a"], message })).toBe(anomalyKey({ kind: "doublon", entryIds: ["a", "b"], message }));
    expect(anomalyKey({ kind: "doublon", entryIds: ["a", "b"], message })).toMatch(/^doublon:a\+b:[0-9a-z]+$/);
    expect(anomalyKey({ kind: "periode", entryIds: ["a", "b"], message })).not.toBe(anomalyKey({ kind: "doublon", entryIds: ["a", "b"], message }));
    expect(shortHash("abc")).toBe(shortHash("abc"));
    expect(shortHash("abc")).not.toBe(shortHash("abd"));
  });

  it("détecte les mêmes clés d'un appel à l'autre", () => {
    const keys = (): string[] => detectHrAnomalies([salaires]).map((item) => item.key);
    expect(keys()).toEqual(keys());
    expect(keys().length).toBeGreaterThan(0);
  });

  it("une anomalie validée sort de la liste, et réapparaît si l'écriture change", () => {
    const [anomaly] = detectHrAnomalies([salaires]).filter((item) => item.kind === "beneficiaire");
    const validation = { key: anomaly!.key, motif: "vu", par: "RH", parId: "u1", le: "2026-11-19T10:00:00.000Z" };
    const apres = partitionAnomalies(detectHrAnomalies([salaires]), [validation]);
    expect(apres.open.filter((item) => item.kind === "beneficiaire")).toHaveLength(0);
    expect(apres.validated).toHaveLength(1);
    // Le bénéficiaire change (toujours incohérent) : le message change, donc la clé aussi, et l'anomalie revient.
    const modifiee = partitionAnomalies(detectHrAnomalies([{ ...salaires, beneficiaire: "Salaires du personnel oct." }]), [validation]);
    expect(modifiee.open.filter((item) => item.kind === "beneficiaire")).toHaveLength(1);
    expect(modifiee.validated).toHaveLength(0);
  });
});
