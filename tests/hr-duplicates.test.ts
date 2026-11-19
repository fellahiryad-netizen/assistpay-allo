import { describe, expect, it } from "vitest";
import { chequeKeys, citedPeriods, compareHrEntries, duplicateMessage, evaluateDuplicate, findHrDuplicate, isProbableDuplicateMessage, normalizeCheque, type HrEntryLike } from "@/features/hr/lib/hr-duplicates";

const entry = (patch: Partial<HrEntryLike>): HrEntryLike => ({
  id: "x",
  nature: "G50",
  sens: "PAIEMENT",
  beneficiaire: "Receveur des impôts",
  mois: "2026-09",
  date: "2026-10-19",
  montant: 13_916_005,
  cheque: "",
  libelle: "",
  ...patch,
});

describe("normalisation des numéros de chèque", () => {
  it("retire préfixes lettres, TL-, AGB, espaces et zéros de tête", () => {
    expect(normalizeCheque("TL-7064740")).toBe("7064740");
    expect(normalizeCheque("7064740")).toBe("7064740");
    expect(normalizeCheque("AGB 7064740")).toBe("7064740");
    expect(normalizeCheque("tl 70 647 40")).toBe("7064740");
    expect(normalizeCheque("0007064740")).toBe("7064740");
    expect(normalizeCheque("")).toBe("");
    expect(normalizeCheque("12")).toBe("");
  });
});

describe("périodes citées dans un libellé", () => {
  it("lit « 09-2026 », « septembre », « aout » et ignore une date complète", () => {
    expect(citedPeriods("G50 09-2026", "2026-10")).toEqual(["2026-09"]);
    expect(citedPeriods("G50 SEPTEMBRE", "2026-11")).toEqual(["2026-09"]);
    expect(citedPeriods("Salaires aout", "2026-09")).toEqual(["2026-08"]);
    expect(citedPeriods("G50 août 2026", "2026-10")).toEqual(["2026-08"]);
    expect(citedPeriods("règlement du 19/10/2026", "2026-10")).toEqual([]);
    expect(citedPeriods("G50 décembre", "2027-01")).toEqual(["2026-12"]);
  });
});

describe("doublon certain", () => {
  it("même chèque (TL-7064740 contre 7064740) et même montant", () => {
    const saisie = entry({ id: "a", cheque: "7064740", date: "2026-10-19" });
    const releve = entry({ id: "b", cheque: "TL-7064740", beneficiaire: "G50 SEPTEMBRE", date: "2026-11-04" });
    expect(compareHrEntries(releve, saisie)?.level).toBe("certain");
  });

  it("même chèque mais montant différent : pas un doublon", () => {
    expect(compareHrEntries(entry({ cheque: "7064740" }), entry({ cheque: "TL-7064740", montant: 13_916_006 }))).toBeNull();
  });

  it("même nature, montant, bénéficiaire et date", () => {
    const found = compareHrEntries(entry({ beneficiaire: "RECEVEUR DES IMPOTS" }), entry({ beneficiaire: "Receveur des impôts" }));
    expect(found?.level).toBe("certain");
  });
});

describe("cas réels", () => {
  it("G50 septembre 13 916 005,00 saisi le 19/10 (virement) puis le 04/11 (transfert par chèque) : doublon probable cité", () => {
    const premiere = entry({ id: "1", date: "2026-10-19", mois: "2026-09", libelle: "G50 09-2026", beneficiaire: "Receveur des impôts" });
    const seconde = entry({ id: "2", date: "2026-11-04", mois: "2026-11", libelle: "G50 SEPTEMBRE", beneficiaire: "G50 SEPTEMBRE", cheque: "TL-7064740" });
    const found = findHrDuplicate(seconde, [premiere]);
    expect(found?.level).toBe("probable");
    const message = duplicateMessage(found!);
    expect(isProbableDuplicateMessage(message)).toBe(true);
    expect(message).toContain("19/10/2026");
    expect(message).toContain("G50 09-2026");
    expect(message).toContain("supprimez l'ancienne");
  });

  it("août 12 925 627,00 saisi le 23/09 sans chèque puis le 12/10 avec chèque : doublon probable", () => {
    const premiere = entry({ id: "1", montant: 12_925_627, date: "2026-09-23", mois: "2026-08", libelle: "G50 août" });
    const seconde = entry({ id: "2", montant: 12_925_627, date: "2026-10-12", mois: "2026-08", cheque: "7064001", libelle: "G50 08-2026" });
    expect(findHrDuplicate(seconde, [premiere])?.level).toBe("probable");
  });

  it("même période mais plus de 45 jours d'écart : encore un doublon probable", () => {
    const premiere = entry({ id: "1", montant: 12_925_627, date: "2026-08-20", mois: "2026-08", libelle: "G50 août" });
    const seconde = entry({ id: "2", montant: 12_925_627, date: "2026-11-12", mois: "2026-11", libelle: "G50 08-2026" });
    expect(findHrDuplicate(seconde, [premiere])?.level).toBe("probable");
  });

  it("IRG 75 468,00 saisi deux fois avec le même chèque : certain, même si les dates diffèrent", () => {
    const a = entry({ id: "1", nature: "IRG", montant: 75_468, cheque: "AGB 7064741", date: "2026-10-20" });
    const b = entry({ id: "2", nature: "IRG", montant: 75_468, cheque: "TL-7064741", date: "2026-11-05", beneficiaire: "IRG octobre" });
    expect(findHrDuplicate(b, [a])?.level).toBe("certain");
  });

  it("deux mois différents cités dans les libellés : pas de doublon probable (G50 identique deux mois de suite)", () => {
    const a = entry({ id: "1", date: "2026-10-19", libelle: "G50 09-2026" });
    const b = entry({ id: "2", date: "2026-11-19", libelle: "G50 10-2026" });
    expect(findHrDuplicate(b, [a])).toBeNull();
  });

  it("faux positif à éviter : deux salaires identiques à des bénéficiaires différents", () => {
    const a = entry({ id: "1", nature: "Salaire", beneficiaire: "Ahmed Benali", montant: 80_000, date: "2026-10-28", mois: "2026-10" });
    const b = entry({ id: "2", nature: "Salaire", beneficiaire: "Karim Haddad", montant: 80_000, date: "2026-10-28", mois: "2026-10" });
    expect(findHrDuplicate(b, [a])).toBeNull();
  });

  it("faux positif à éviter : même salaire, même employé, deux mois consécutifs", () => {
    const a = entry({ id: "1", nature: "Salaire", beneficiaire: "Ahmed Benali", montant: 80_000, date: "2026-09-28", mois: "2026-09" });
    const b = entry({ id: "2", nature: "Salaire", beneficiaire: "Ahmed Benali", montant: 80_000, date: "2026-10-28", mois: "2026-10" });
    expect(findHrDuplicate(b, [a])).toBeNull();
  });

  it("même salaire, même employé, même mois, dates différentes : probable", () => {
    const a = entry({ id: "1", nature: "Salaire", beneficiaire: "Ahmed Benali", montant: 80_000, date: "2026-10-28", mois: "2026-10" });
    const b = entry({ id: "2", nature: "Salaire", beneficiaire: "Ahmed Benali", montant: 80_000, date: "2026-10-30", mois: "2026-10" });
    expect(findHrDuplicate(b, [a])?.level).toBe("probable");
  });
});

describe("modification et sens", () => {
  it("en modification, l'écriture elle-même est exclue", () => {
    const a = entry({ id: "1", cheque: "7064740" });
    expect(findHrDuplicate({ ...a }, [a], "1")).toBeNull();
  });

  it("un retour n'est pas le doublon d'un paiement", () => {
    expect(compareHrEntries(entry({ sens: "RETOUR", cheque: "7064740" }), entry({ cheque: "7064740" }))).toBeNull();
  });

  it("préfère le doublon certain au probable", () => {
    const probable = entry({ id: "p", date: "2026-10-01", cheque: "" });
    const certain = entry({ id: "c", date: "2026-10-19", cheque: "TL-7064740" });
    expect(findHrDuplicate(entry({ cheque: "7064740" }), [probable, certain])?.entry.id).toBe("c");
  });
});

describe("chèques : seuil et séparateurs", () => {
  it("ignore moins de 5 chiffres et sépare deux chèques par un tiret", () => {
    expect(chequeKeys("1234")).toEqual([]);
    expect(chequeKeys("TL-7064740")).toEqual(["7064740"]);
    expect(chequeKeys("7064740-7064741")).toEqual(["7064740", "7064741"]);
    expect(chequeKeys("7064740 / 7064741")).toEqual(["7064740", "7064741"]);
  });
});

describe("corrections du relecteur", () => {
  it("1. mêmes nature, bénéficiaire, montant et date mais deux chèques différents : pas un doublon certain", () => {
    const a = entry({ id: "1", cheque: "7064740", libelle: "G50 09-2026" });
    const b = entry({ id: "2", cheque: "7064741", libelle: "G50 09-2026" });
    expect(compareHrEntries(b, a)?.level).not.toBe("certain");
    // Un seul chèque renseigné : la règle « même date » reste certaine.
    expect(compareHrEntries(entry({ id: "3", cheque: "" }), a)?.level).toBe("certain");
  });

  it("2. G50 de septembre payé le 20/10 et G50 d'octobre payé le 20/11 (mois saisis différents, sans période citée) : pas de doublon", () => {
    const sept = entry({ id: "1", mois: "2026-09", date: "2026-10-20", beneficiaire: "Receveur des impôts" });
    const oct = entry({ id: "2", mois: "2026-10", date: "2026-11-20", beneficiaire: "DGI" });
    expect(compareHrEntries(oct, sept)).toBeNull();
    // Même mois saisi, ou mois vide : la fenêtre de 45 jours s'applique.
    expect(compareHrEntries({ ...oct, mois: "2026-09" }, sept)?.level).toBe("probable");
    expect(compareHrEntries({ ...oct, mois: "" }, sept)?.level).toBe("probable");
  });

  it("3. mois cité sans année à cheval sur décembre et janvier", () => {
    expect(citedPeriods("G50 décembre", "2027-01")).toEqual(["2026-12"]);
    expect(citedPeriods("G50 janvier", "2026-12")).toEqual(["2027-01"]);
    expect(citedPeriods("G50 janvier", "2027-01")).toEqual(["2027-01"]);
    const a = entry({ id: "1", mois: "2026-12", date: "2027-01-10", libelle: "G50 12-2026" });
    const b = entry({ id: "2", mois: "2027-01", date: "2027-01-20", libelle: "G50 décembre" });
    expect(compareHrEntries(b, a)?.level).toBe("probable");
  });
});

describe("garde-fou : exemption en modification et confirmation", () => {
  const voisine = entry({ id: "v", libelle: "G50 09-2026", cheque: "7064740" });
  const stockee = entry({ id: "m", libelle: "G50 09-2026", cheque: "TL-7064740", beneficiaire: "G50 SEPTEMBRE" });

  it("un doublon déjà présent avant la correction ne bloque pas la correction d'un autre champ", () => {
    const corrigee = { ...stockee, beneficiaire: "Receveur des impôts" };
    expect(evaluateDuplicate(corrigee, stockee, [voisine, stockee], false)).toEqual({ allowed: true, confirmed: null });
  });

  it("une nouvelle écriture identique est refusée (certain, jamais confirmable)", () => {
    const decision = evaluateDuplicate({ ...stockee, id: undefined }, undefined, [voisine], true);
    expect(decision.allowed).toBe(false);
  });

  it("l'exemption compare des ensembles : un second doublon apparu à la modification bloque", () => {
    const autre = entry({ id: "w", cheque: "9999999", libelle: "G50 09-2026", date: "2026-10-25", beneficiaire: "Autre" });
    const base = entry({ id: "m", cheque: "", libelle: "G50 09-2026", date: "2026-11-30", mois: "2026-09", montant: 13_916_005 });
    // Avant et après : les deux voisines sont déjà des doublons probables, donc la correction passe ; un doublon devenu certain bloque.
    const decision = evaluateDuplicate(base, base, [voisine, autre], false);
    expect(decision.allowed).toBe(true);
    const nouveau = { ...base, cheque: "7064740" };
    const refus = evaluateDuplicate(nouveau, base, [voisine, autre], true);
    expect(refus.allowed).toBe(false);
  });

  it("un doublon probable est confirmable et renvoie l'écriture voisine", () => {
    const premiere = entry({ id: "1", date: "2026-10-19", libelle: "G50 09-2026" });
    const seconde = entry({ id: "2", date: "2026-11-04", mois: "2026-11", libelle: "G50 SEPTEMBRE", beneficiaire: "G50 SEPTEMBRE", cheque: "TL-7064740" });
    expect(evaluateDuplicate({ ...seconde, id: undefined }, undefined, [premiere], false).allowed).toBe(false);
    const decision = evaluateDuplicate({ ...seconde, id: undefined }, undefined, [premiere], true);
    expect(decision).toMatchObject({ allowed: true, confirmed: { level: "probable" } });
  });
});
