import { describe, expect, it } from "vitest";
import { cleanPersonName, cleanPhones, cleanText, telHref } from "@/features/courrier/lib/clean";
import { buildDefaultBook, cleanBranchName, RAW_BRANCHES } from "@/features/courrier/lib/seed";

const NBSP = String.fromCharCode(160);

describe("nettoyage des textes", () => {
  it("remplace les espaces insécables, réduit les espaces et retire ceux du début et de la fin", () => {
    expect(cleanText(`  SUCCURSALE${NBSP}CAAT   ALGER 2 `)).toBe("SUCCURSALE CAAT ALGER 2");
    expect(cleanText(`TEL${NBSP}: 0542`)).toBe("TEL : 0542");
  });

  it("retire l'espace avant une apostrophe collée au mot suivant", () => {
    expect(cleanText("RESIDENCE CHAABANI VAL-D 'HYDRA ALGER")).toBe("RESIDENCE CHAABANI VAL-D'HYDRA ALGER");
    expect(cleanText("RUE LARBI BEN-M'HIDI")).toBe("RUE LARBI BEN-M'HIDI");
  });

  it("téléphones : retire « TEL : » sous toutes ses formes, garde les séries de numéros", () => {
    expect(cleanPhones(`TEL${NBSP}: 0661 49 00 38 - 021 83 33 64`)).toBe("0661 49 00 38 - 021 83 33 64");
    expect(cleanPhones("TEL :0661 51 00 69")).toBe("0661 51 00 69");
    expect(cleanPhones("038 84 50 31 / 038 84 49 11  ")).toBe("038 84 50 31 / 038 84 49 11");
    expect(cleanPhones("041 70 68 01 /04 /05 à 07")).toBe("041 70 68 01 /04 /05 à 07");
    expect(cleanPhones("031 60 65 00/ 02    031 60 64 97")).toBe("031 60 65 00/ 02 031 60 64 97");
    expect(cleanPhones("")).toBe("");
  });

  it("noms de contacts : espace après la civilité", () => {
    expect(cleanPersonName("M.LAYADA ADIL")).toBe("M. LAYADA ADIL");
    expect(cleanPersonName("Mr. LAZZOUNI MONCEF")).toBe("Mr. LAZZOUNI MONCEF");
  });

  it("noms de succursales : Ghardaïa et Bouzareah corrigés, le reste inchangé", () => {
    expect(cleanBranchName("SUCCURSALE CAAT GHERDAIA")).toBe("SUCCURSALE CAAT GHARDAÏA");
    expect(cleanBranchName("SUCCURSALE CAAT GHARDAIA")).toBe("SUCCURSALE CAAT GHARDAÏA");
    expect(cleanBranchName("SUCCURSALE CAAR BOUZEREAH 600")).toBe("SUCCURSALE CAAR BOUZAREAH 600");
    expect(cleanBranchName("SUCCURSALE CAAR ORAN 400")).toBe("SUCCURSALE CAAR ORAN 400");
  });

  it("lien d'appel : premier numéro seulement, chiffres et « + »", () => {
    expect(telHref("0697 38 88 81")).toBe("tel:0697388881");
    expect(telHref("+213 982 30 40 40 / +213 23 13 59 31")).toBe("tel:+213982304040");
    expect(telHref("")).toBe("");
    expect(telHref("poste 12")).toBe("");
  });
});

describe("liste de départ (fichier Excel)", () => {
  const book = buildDefaultBook();
  const branch = (id: string) => book.branches.find((item) => item.id === id);

  it("reprend les 13 succursales (9 CAAT et 4 CAAR) et les 2 contacts EMS", () => {
    expect(book.branches).toHaveLength(13);
    expect(book.branches.filter((item) => item.compagnie === "CAAT")).toHaveLength(9);
    expect(book.branches.filter((item) => item.compagnie === "CAAR")).toHaveLength(4);
    expect(book.emsContacts).toHaveLength(2);
    expect(book.emsSociete).toBe("EMS");
    expect(RAW_BRANCHES).toHaveLength(13);
  });

  it("identifiants uniques et stables", () => {
    const ids = [...book.branches.map((item) => item.id), ...book.emsContacts.map((item) => item.id)];
    expect(new Set(ids).size).toBe(ids.length);
    expect(branch("caar-oran-400")?.nom).toBe("SUCCURSALE CAAR ORAN 400");
  });

  it("aucun espace insécable, aucune espace double, aucun « TEL » dans les données nettoyées", () => {
    for (const item of book.branches) {
      for (const value of [item.nom, item.contact, item.telephones, item.adresse]) {
        expect(value).not.toContain(NBSP);
        expect(value).not.toMatch(/ {2}/);
        expect(value).toBe(value.trim());
      }
      expect(item.telephones).not.toMatch(/^tel/i);
    }
  });

  it("Ghardaïa écrit une seule fois, avec le tréma", () => {
    const names = book.branches.map((item) => item.nom).filter((nom) => /GH[AE]RDA/.test(nom));
    expect(names).toEqual(["SUCCURSALE CAAT GHARDAÏA"]);
  });

  it("ne rien inventer : Alger 3 sans téléphone, les quatre CAAR sans contact", () => {
    expect(branch("caat-alger-3")?.telephones).toBe("");
    for (const item of book.branches.filter((entry) => entry.compagnie === "CAAR")) expect(item.contact).toBe("");
    expect(branch("caat-alger-2")?.contact).toBe("Mr. AMEZIANE MAKHLOUF");
    expect(branch("caat-annaba")?.contact).toBe("M. LAYADA ADIL");
    expect(branch("caat-annaba")?.telephones).toBe("0661 51 00 69");
  });

  it("les adresses du modèle Word sont reprises à l'identique", () => {
    expect(branch("caar-oran-400")).toMatchObject({ adresse: "CITE ADMINISTRATIVE ILOT 26 ZHUN-USTO ORAN", telephones: "041 70 68 01 /04 /05 à 07" });
    expect(branch("caar-constantine-500")?.adresse).toBe("Zone Industrielle le Rhumel bp 399 - Constantine 25000 Algerie");
  });

  it("contacts EMS : Hichem ramasseur, Mme Illoul pour les réclamations avec son e-mail", () => {
    expect(book.emsContacts.find((item) => item.id === "ems-hichem")).toMatchObject({ nom: "Hichem", role: "RAMASSEUR", telephone: "0697 38 88 81", email: "" });
    expect(book.emsContacts.find((item) => item.id === "ems-illoul")).toMatchObject({ nom: "Mme Illoul", role: "RECLAMATION", telephone: "0697 67 21 88", email: "illoul.m@ems.dz" });
  });
});
