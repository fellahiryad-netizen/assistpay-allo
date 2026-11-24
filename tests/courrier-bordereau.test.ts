import { describe, expect, it } from "vitest";
import { parseAddressBook } from "@/features/courrier/lib/address-book";
import { bordereauDateLabel, bordereauHref, branchDestination, buildBordereauLines, defaultDestination, totalPlis } from "@/features/courrier/lib/bordereau";
import { buildDefaultBook } from "@/features/courrier/lib/seed";
import { bordereauLinesOf, bordereauQuerySchema, branchSchema } from "@/features/courrier/schemas";
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

describe("paramètres de l'adresse d'impression", () => {
  const lines = buildBordereauLines([byId("caat-alger-3"), byId("caar-oran-400")]);
  const toRaw = (href: string) => {
    const query = new URL(href, "http://x").searchParams;
    return { date: query.get("date") ?? undefined, cachet: query.get("cachet") ?? undefined, des: query.getAll("des"), qnt: query.getAll("qnt"), dst: query.getAll("dst"), obs: query.getAll("obs"), ram: query.get("ram") ?? undefined };
  };

  it("aller-retour : l'adresse construite se relit identique et ne contient aucun identifiant", () => {
    const href = bordereauHref({ date: "2026-11-24", cachet: true, ramasseur: "Hichem", lines });
    expect(href.startsWith("/imprimer/bordereau?")).toBe(true);
    const parsed = bordereauQuerySchema.parse(toRaw(href));
    expect(parsed.date).toBe("2026-11-24");
    expect(parsed.cachet).toBe(true);
    expect(parsed.ram).toBe("Hichem");
    expect(bordereauLinesOf(parsed)).toEqual(lines);
    expect(href).not.toMatch(/ids=|caat-alger-3|caar-oran-400/);
  });

  it("une ligne unique (paramètres non répétés) est acceptée ; cachet=0 le désactive", () => {
    const parsed = bordereauQuerySchema.parse({ date: "2026-11-24", cachet: "0", des: "X", qnt: "2", dst: "", obs: "" });
    expect(parsed.cachet).toBe(false);
    expect(bordereauLinesOf(parsed)).toEqual([{ designation: "X", qnt: 2, destination: "", observation: "" }]);
  });

  it("refuse une date impossible ou absente, une quantité fausse, des listes de longueurs différentes, aucune ligne, trop de lignes", () => {
    const ok = { date: "2026-11-24", des: ["A"], qnt: ["1"], dst: ["B"], obs: ["C"] };
    expect(bordereauQuerySchema.safeParse(ok).success).toBe(true);
    expect(bordereauQuerySchema.safeParse({ ...ok, date: "2026-02-31" }).success).toBe(false);
    expect(bordereauQuerySchema.safeParse({ ...ok, date: undefined }).success).toBe(false);
    expect(bordereauQuerySchema.safeParse({ ...ok, date: "24/11/2026" }).success).toBe(false);
    for (const qnt of ["0", "-1", "1.5", "abc", "10000", ""]) expect(bordereauQuerySchema.safeParse({ ...ok, qnt: [qnt] }).success, qnt).toBe(false);
    expect(bordereauQuerySchema.safeParse({ ...ok, qnt: ["1", "2"] }).success).toBe(false);
    expect(bordereauQuerySchema.safeParse({ ...ok, des: [], qnt: [], dst: [], obs: [] }).success).toBe(false);
    expect(bordereauQuerySchema.safeParse({ date: "2026-11-24" }).success).toBe(false);
    const many = Array.from({ length: 61 }, () => "1");
    expect(bordereauQuerySchema.safeParse({ date: "2026-11-24", des: many, qnt: many, dst: many, obs: many }).success).toBe(false);
    expect(bordereauQuerySchema.safeParse({ ...ok, des: ["   "] }).success).toBe(false);
    expect(bordereauQuerySchema.safeParse({ ...ok, des: ["A".repeat(121)] }).success).toBe(false);
    expect(bordereauQuerySchema.safeParse({ ...ok, cachet: "oui" }).success).toBe(false);
  });

  it("les textes sont nettoyés (espaces insécables et multiples)", () => {
    const parsed = bordereauQuerySchema.parse({ date: "2026-11-24", des: [`SUCCURSALE${String.fromCharCode(160)}  CAAR`], qnt: ["1"], dst: [" ORAN "], obs: [""] });
    expect(parsed.des[0]).toBe("SUCCURSALE CAAR");
    expect(parsed.dst[0]).toBe("ORAN");
  });

  it("ramasseur : contact choisi, nom libre (remplaçant) nettoyé, ou vide (ligne à remplir)", () => {
    const base = { date: "2026-11-24", des: ["A"], qnt: ["1"], dst: [""], obs: [""] };
    const hichem = bordereauHref({ date: "2026-11-24", cachet: true, ramasseur: "Hichem", lines });
    expect(toRaw(hichem).des).toHaveLength(2);
    expect(new URL(hichem, "http://x").searchParams.get("ram")).toBe("Hichem");
    expect(bordereauQuerySchema.parse({ ...base, ram: "Hichem" }).ram).toBe("Hichem");
    expect(bordereauQuerySchema.parse({ ...base, ram: `  Karim${String.fromCharCode(160)}  B. ` }).ram).toBe("Karim B.");
    const vide = bordereauHref({ date: "2026-11-24", cachet: true, ramasseur: "   ", lines });
    expect(new URL(vide, "http://x").searchParams.has("ram")).toBe(false);
    expect(bordereauQuerySchema.parse(base).ram).toBe("");
    expect(bordereauQuerySchema.parse({ ...base, ram: "" }).ram).toBe("");
  });

  it("ramasseur : 80 caractères au plus", () => {
    const base = { date: "2026-11-24", des: ["A"], qnt: ["1"], dst: [""], obs: [""] };
    expect(bordereauQuerySchema.safeParse({ ...base, ram: "x".repeat(80) }).success).toBe(true);
    expect(bordereauQuerySchema.safeParse({ ...base, ram: "x".repeat(81) }).success).toBe(false);
  });
});
