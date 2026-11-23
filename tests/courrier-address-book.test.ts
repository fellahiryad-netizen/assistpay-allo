import { describe, expect, it } from "vitest";
import { filterBranches, matchBranch, parseAddressBook, pickBranches } from "@/features/courrier/lib/address-book";
import { buildDefaultBook } from "@/features/courrier/lib/seed";

const { branches } = buildDefaultBook();

describe("recherche et filtre par compagnie", () => {
  it("filtre par compagnie", () => {
    expect(filterBranches(branches, "CAAR", "")).toHaveLength(4);
    expect(filterBranches(branches, "CAAT", "")).toHaveLength(9);
    expect(filterBranches(branches, "", "")).toHaveLength(13);
  });

  it("recherche sans accent ni casse, dans le nom, l'adresse, le téléphone et le contact", () => {
    expect(filterBranches(branches, "", "ghardaia").map((item) => item.id)).toEqual(["caat-ghardaia"]);
    expect(filterBranches(branches, "", "GHARDAÏA").map((item) => item.id)).toEqual(["caat-ghardaia"]);
    expect(filterBranches(branches, "", "rhumel").map((item) => item.id)).toEqual(["caar-constantine-500"]);
    expect(filterBranches(branches, "", "0661 51 00 69").map((item) => item.id)).toEqual(["caat-annaba"]);
    expect(filterBranches(branches, "", "makhlouf").map((item) => item.id)).toEqual(["caat-alger-2"]);
  });

  it("compagnie et recherche se combinent ; aucune correspondance donne une liste vide", () => {
    expect(filterBranches(branches, "CAAR", "oran").map((item) => item.id)).toEqual(["caar-oran-400"]);
    expect(filterBranches(branches, "CAAT", "oran").map((item) => item.id)).toEqual(["caat-oran"]);
    expect(filterBranches(branches, "CAAR", "setif")).toEqual([]);
  });
});

describe("sélection pour l'impression", () => {
  it("garde l'ordre demandé et ignore les identifiants inconnus", () => {
    expect(pickBranches(branches, ["caar-oran-400", "nope", "caat-setif"]).map((item) => item.id)).toEqual(["caar-oran-400", "caat-setif"]);
    expect(pickBranches(branches, [])).toEqual([]);
  });
});

describe("lecture tolérante", () => {
  it("une valeur qui n'est pas un objet donne null (liste de départ)", () => {
    for (const value of [null, undefined, 4, "x", [], true]) expect(parseAddressBook(value)).toBeNull();
  });

  it("un objet vide donne un carnet vide, sans exception", () => {
    expect(parseAddressBook({})).toEqual({ branches: [], emsSociete: "EMS", emsContacts: [] });
  });

  it("un identifiant illisible est remplacé, un rôle inconnu devient « réclamations »", () => {
    const book = parseAddressBook({ branches: [{ id: "a b", compagnie: "CAAT", nom: "Setif" }], emsContacts: [{ id: "e1", nom: "X", role: "BOSS" }] });
    expect(book?.branches[0]?.id).toBe("succ-lu-1");
    expect(book?.emsContacts[0]?.role).toBe("RECLAMATION");
  });
});

describe("succursale d'une facture (lien « Imprimer l'enveloppe » de la fiche partenaire)", () => {
  it("retrouve la fiche à partir de la clé du partenaire et du nom de succursale des factures", () => {
    expect(matchBranch(branches, "CAAR", "ORAN")?.id).toBe("caar-oran-400");
    expect(matchBranch(branches, "CAAT", "ORAN")?.id).toBe("caat-oran");
    expect(matchBranch(branches, "CAAR", "BOUZAREAH")?.id).toBe("caar-bouzareah-600");
    expect(matchBranch(branches, "CAAT", "ALGER II")?.id).toBe("caat-alger-2");
    expect(matchBranch(branches, "CAAT", "ALGER III")?.id).toBe("caat-alger-3");
    expect(matchBranch(branches, "CAAT", "GHARDAIA")?.id).toBe("caat-ghardaia");
    expect(matchBranch(branches, "CAAT BDG", "SETIF")?.id).toBe("caat-setif");
  });

  it("ne devine jamais : succursale absente du carnet, compagnie inconnue ou nom vide donnent null", () => {
    expect(matchBranch(branches, "CAAR", "CHERAGA")).toBeNull();
    expect(matchBranch(branches, "CAAR", "SETIF")).toBeNull();
    expect(matchBranch(branches, "GAM", "ORAN")).toBeNull();
    expect(matchBranch(branches, "CAAR", "")).toBeNull();
  });

  it("deux fiches qui correspondent : null plutôt qu'un choix au hasard", () => {
    const twin = { ...branches.find((item) => item.id === "caar-oran-400")!, id: "autre", nom: "SUCCURSALE CAAR ORAN 401" };
    expect(matchBranch([...branches, twin], "CAAR", "ORAN")).toBeNull();
  });
});
