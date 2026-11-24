import { describe, expect, it } from "vitest";
import { parseAddressBook } from "@/features/courrier/lib/address-book";
import { bordereauDateLabel, branchDestination, buildBordereauLines, buildEditorLines, defaultDestination, totalPlis } from "@/features/courrier/lib/bordereau";
import { buildDefaultBook } from "@/features/courrier/lib/seed";
import { branchSchema } from "@/features/courrier/schemas";
import { DEFAULT_OBSERVATION } from "@/features/courrier/types";
import { todayIso } from "@/utils/dates";

const { branches } = buildDefaultBook();
const byId = (id: string) => branches.find((item) => item.id === id)!;

describe("destination par défaut (ville de l'adresse)", () => {
  it("dernier mot significatif, avec les accents des villes connues", () => {
    expect(defaultDestination("CITE ADMINISTRATIVE ILOT 26 ZHUN-USTO ORAN")).toBe("ORAN");
    expect(defaultDestination("HAI EL-HOUMRIA AVENUE WELD KABLIA SALIHA TOURS EDEN-ORAN")).toBe("ORAN");
    expect(defaultDestination("CITE 05 JUILLET, ROUTE DU PARC D'ATTRACTION.ANNABA")).toBe("ANNABA");
    expect(defaultDestination("RUE LARBI BEN-M'HIDI, ROUTE DE BEN-ISGUEN GHARDAÏA")).toBe("GHARDAÏA");
    expect(defaultDestination("CITE ADMINISTRATIVE AIN-TBINET SETIF")).toBe("SÉTIF");
    expect(defaultDestination("SECTION 111, CITE LES DHALIAS EL-KIFFAN TLEMCEN")).toBe("TLEMCEN");
    expect(defaultDestination("6, BOULEVARD AMIROUCHE ALGER")).toBe("ALGER");
  });

  it("ignore le pays et les nombres : « Constantine 25000 Algerie » donne CONSTANTINE", () => {
    expect(defaultDestination("Zone Industrielle le Rhumel bp 399 - Constantine 25000 Algerie")).toBe("CONSTANTINE");
    expect(defaultDestination("12 rue des Lilas 16000")).toBe("LILAS");
  });

  it("ville inconnue reprise en majuscules ; adresse vide ou sans mot : chaîne vide", () => {
    expect(defaultDestination("Route nationale, Biskra")).toBe("BISKRA");
    expect(defaultDestination("")).toBe("");
    expect(defaultDestination("25000 ,")).toBe("");
  });

  it("la liste de départ : modèle du propriétaire pour Alger 3 et Oran 400, la ville pour les autres", () => {
    expect(byId("caat-alger-3").destination).toBe("CITE CHAABANI HYDRA ALGER");
    expect(byId("caar-oran-400").destination).toBe("ORAN");
    const expected: Record<string, string> = {
      "caat-alger-1": "ALGER", "caat-alger-2": "ALGER", "caat-annaba": "ANNABA", "caat-constantine": "CONSTANTINE", "caat-ghardaia": "GHARDAÏA", "caat-oran": "ORAN",
      "caat-setif": "SÉTIF", "caat-tlemcen": "TLEMCEN", "caar-annaba-300": "ANNABA", "caar-bouzareah-600": "ALGER", "caar-constantine-500": "CONSTANTINE",
    };
    for (const [id, city] of Object.entries(expected)) expect(byId(id).destination, id).toBe(city);
  });
});

describe("fiches anciennes sans champ destination", () => {
  it("la lecture tolérante donne une destination vide, la ville de l'adresse s'applique à l'impression", () => {
    const book = parseAddressBook({ branches: [{ id: "a", compagnie: "CAAR", nom: "SUCCURSALE CAAR ORAN 400", adresse: "CITE ADMINISTRATIVE ILOT 26 ZHUN-USTO ORAN" }] });
    expect(book?.branches[0]?.destination).toBe("");
    expect(branchDestination(book!.branches[0]!)).toBe("ORAN");
  });

  it("une destination saisie est gardée telle quelle, nettoyée", () => {
    expect(branchDestination({ destination: "  ORAN  centre ", adresse: "x ALGER" })).toBe("ORAN centre");
  });

  it("le formulaire sans destination reste valide (valeur vide), avec destination elle est nettoyée et plafonnée", () => {
    const base = { compagnie: "CAAR", nom: "N", contact: "", telephones: "", adresse: "A", remarque: "" };
    expect(branchSchema.parse(base).destination).toBe("");
    expect(branchSchema.parse({ ...base, destination: " ORAN " }).destination).toBe("ORAN");
    expect(branchSchema.safeParse({ ...base, destination: "x".repeat(121) }).success).toBe(false);
  });
});

describe("lignes du bordereau", () => {
  it("une ligne par fiche choisie, quantité 1, observation par défaut, dans l'ordre", () => {
    const lines = buildBordereauLines([byId("caat-alger-3"), byId("caar-oran-400")]);
    expect(lines).toEqual([
      { designation: "SUCCURSALE CAAT ALGER 3", qnt: 1, destination: "CITE CHAABANI HYDRA ALGER", observation: DEFAULT_OBSERVATION },
      { designation: "SUCCURSALE CAAR ORAN 400", qnt: 1, destination: "ORAN", observation: "COURRIER : DOCUMENT FACTURATION" },
    ]);
  });

  it("l'observation par défaut s'écrit DOCUMENT (et non la faute du modèle papier)", () => {
    expect(DEFAULT_OBSERVATION).not.toMatch(/DOCUEMENT/);
    expect(DEFAULT_OBSERVATION).toContain("DOCUMENT");
  });

  it("total de plis : somme des quantités, 0 sans ligne", () => {
    const lines = buildBordereauLines(branches.slice(0, 5));
    expect(totalPlis(lines)).toBe(5);
    expect(totalPlis([{ qnt: 3 }, { qnt: 2 }, { qnt: 10 }])).toBe(15);
    expect(totalPlis([])).toBe(0);
  });

  it("date « ALGER LE : JJ/MM/AAAA »", () => {
    expect(bordereauDateLabel("2026-11-24")).toBe("ALGER LE : 24/11/2026");
    expect(bordereauDateLabel("2026-01-05")).toBe("ALGER LE : 05/01/2026");
  });

  it("la date du jour est celle d'Alger (AAAA-MM-JJ)", () => {
    expect(todayIso()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const algiers = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Algiers" }).format(new Date());
    expect(todayIso()).toBe(algiers);
  });
});

describe("lignes de l'éditeur (enregistrées dans l'historique)", () => {
  it("gardent l'identifiant et la compagnie de la fiche, en plus des champs du bordereau", () => {
    const lines = buildEditorLines([byId("caat-alger-3"), byId("caar-oran-400")]);
    expect(lines[0]).toEqual({ brancheId: "caat-alger-3", compagnie: "CAAT", designation: "SUCCURSALE CAAT ALGER 3", qnt: 1, destination: "CITE CHAABANI HYDRA ALGER", observation: DEFAULT_OBSERVATION });
    expect(lines[1]).toMatchObject({ brancheId: "caar-oran-400", compagnie: "CAAR", destination: "ORAN" });
  });
});
