import { describe, expect, it } from "vitest";
import { basePolice, type AnalysedLine, type BaseRow } from "@/features/regul/services/regul-engine";
import { buildFichiers, compterParAgence, croiserPolices, filtrerStatut, type RegulFichier } from "@/features/regul/services/regul-polices";
import { buildPolicesSheets } from "@/features/regul/services/regul-polices-sheets";
import { parsePolicesQuery } from "@/features/regul/services/regul-polices-query";

const line = (over: Partial<AnalysedLine>): AnalysedLine => ({
  immat: "123456-116-16",
  agence: "AG A",
  client: "X",
  code: 100,
  ville: "",
  marque: "",
  emis: "",
  em: 7,
  police: "P1/0",
  debut: "",
  fin: "",
  produit: "Rapide",
  prime: 1000,
  pa: 500,
  m: 7,
  fichier: "ALLO_JUIL.xlsx",
  im: "12345611616",
  bp: "P1",
  nprod: 1,
  plus: false,
  sinistre: null,
  soldePrime: 0,
  soldePa: 0,
  autres: "",
  ...over,
});

const fichier = (mois: number, rows: RegulFichier["rows"], agences: Record<string, string> = { "100": "AG A" }): RegulFichier => ({ succ: "ORAN", mois, annee: 2026, maj: "2026-11-18", fichiers: ["f.xlsx"], agences, produits: ["Rapide"], rows });
const base = (mois: number, code: number, police: string, immat: string, prime = 1000, pa = 500): BaseRow => [mois, code, police, immat, 0, prime, pa];

describe("buildFichiers", () => {
  it("dédoublonne un même contenu déposé en xlsx et en csv, et garde les lignes identiques d'un même fichier", () => {
    const a = line({ fichier: "ALLO_JUIL.xlsx" });
    const b = line({ fichier: "ALLO_JUIL.csv" });
    const twin = line({ fichier: "ALLO_JUIL.xlsx", police: "P2/0", bp: "P2" });
    const out = buildFichiers("ORAN", 2026, { valid: [a, b, twin, twin], annul: [], garan: [] }, "2026-11-18");
    expect(out).toHaveLength(1);
    expect(out[0]?.rows.filter((r) => r[1] === "P1")).toHaveLength(1);
    expect(out[0]?.rows.filter((r) => r[1] === "P2")).toHaveLength(2);
    expect(out[0]?.fichiers[0]).toBe("ALLO_JUIL.xlsx");
  });
  it("sépare les mois et marque les annulations et changements de garantie", () => {
    const out = buildFichiers("ORAN", 2026, { valid: [line({ m: 7 })], annul: [line({ m: 8, prime: -5, bp: "P9", police: "P9/1" })], garan: [line({ m: 8, prime: -5, bp: "P8", police: "P8/1" })] }, "");
    expect(out.map((f) => f.mois)).toEqual([7, 8]);
    expect(out[1]?.rows.map((r) => r[5]).sort()).toEqual([1, 2]);
    expect(out[0]?.agences["100"]).toBe("AG A");
  });
  it("remplace proprement : deux constructions identiques donnent le même contenu", () => {
    const g = { valid: [line({})], annul: [], garan: [] };
    expect(buildFichiers("ORAN", 2026, g, "x")).toEqual(buildFichiers("ORAN", 2026, g, "x"));
  });
});

describe("croiserPolices", () => {
  const imm = (n: string): string => `${n}-116-16`;
  const bases: BaseRow[] = [
    base(7, 100, "P1/0", imm("111111")),
    base(7, 100, "P2/0", imm("222222")),
    base(7, 100, "P3/0", imm("333333")),
    base(7, 100, "P4/0", imm("444444")),
    base(7, 100, "P5/0", imm("555555"), -1000, -500),
  ];
  const regul = [
    fichier(7, [[100, "P1", imm("111111"), 0, 500, 0]]),
    fichier(8, [[100, "P2", imm("222222"), 0, 500, 0]]),
  ];
  const res = croiserPolices("ORAN", bases, regul, new Set(["P4|44444411616", "P5|55555511616"]), {}, { mois: [7] });

  it("classe reportée, annulée, introuvable", () => {
    const st = Object.fromEntries(res.absentes.map((x) => [x.police, x.statut]));
    expect(st).toEqual({ P2: "REPORTEE", P3: "INTROUVABLE", P4: "INTROUVABLE", P5: "ANNULEE" });
    expect(res.absentes.find((x) => x.police === "P2")?.reapparition).toEqual([8]);
    expect(res.absentes.find((x) => x.police === "P2")?.reapparitionSource).toBe("regul");
  });
  it("sort sinistrées et annulées + sinistre avec la clé police | immatriculation du moteur", () => {
    expect(res.sinistrees.map((x) => x.police).sort()).toEqual(["P4", "P5"]);
    expect(res.annuleesSinistre.map((x) => x.police)).toEqual(["P5"]);
    expect(res.annulees.map((x) => x.police)).toEqual(["P5"]);
  });
  it("une police retrouvée n'est pas listée", () => {
    expect(res.absentes.some((x) => x.police === "P1")).toBe(false);
  });
  it("réapparition au consolidé d'un mois suivant", () => {
    const r = croiserPolices("ORAN", [...bases, base(9, 100, "P3/0", imm("333333"))], regul, null, {}, { mois: [7] });
    const p3 = r.absentes.find((x) => x.police === "P3");
    expect(p3?.statut).toBe("REPORTEE");
    expect(p3?.reapparitionSource).toBe("base");
    expect(p3?.sinistre).toBeNull();
  });
  it("annulation en régularisation sans ligne positive : annulée", () => {
    const r = croiserPolices("ORAN", [base(7, 100, "P6/0", imm("666666"))], [fichier(7, [[100, "P7", imm("777777"), 0, 1, 0]]), fichier(8, [[100, "P6", imm("666666"), 0, -500, 1]])], null, {}, { mois: [7] });
    expect(r.absentes[0]?.statut).toBe("ANNULEE");
  });
  it("signale les mois sans régularisation conservée", () => {
    const r = croiserPolices("ORAN", bases, regul, null, {}, { mois: [9] });
    expect(r.moisSansRegul).toEqual([9]);
    expect(r.absentes).toHaveLength(0);
  });
  it("filtre par agence et par statut, ventile par agence", () => {
    const r = croiserPolices("ORAN", [...bases, base(7, 200, "Q1/0", imm("999999"))], regul, null, { "200": "AG B" }, { mois: [7] });
    expect(croiserPolices("ORAN", [...bases, base(7, 200, "Q1/0", imm("999999"))], regul, null, {}, { mois: [7], agence: 200 }).absentes).toHaveLength(1);
    expect(filtrerStatut(r, "REPORTEE").absentes.map((x) => x.police)).toEqual(["P2"]);
    const ag = compterParAgence(r);
    expect(ag.map((a) => a.code)).toEqual([100, 200]);
    expect(ag[1]?.agence).toBe("AG B");
    expect(ag[0]?.absentes).toBe(4);
  });
  it("police sans avenant : P1/3 et P1/0 sont la même police", () => {
    expect(basePolice("p1/3")).toBe("P1");
    const r = croiserPolices("ORAN", [base(7, 100, "P1/3", imm("111111"))], regul, null, {}, { mois: [7] });
    expect(r.absentes).toHaveLength(0);
  });
});

describe("export et paramètres", () => {
  it("construit les feuilles attendues", () => {
    const r = croiserPolices("ORAN", [base(7, 100, "P3/0", "333333-116-16")], [fichier(7, [[100, "P1", "111111-116-16", 0, 500, 0]])], null, {}, { mois: [7] });
    const names = buildPolicesSheets({ blocks: [{ result: r, agences: compterParAgence(r) }], sinLoaded: false, sansRegul: [] }).map((s) => s.name);
    expect(names).toEqual(["Synthèse", "Synthèse agences", "Oran", "Non retrouvées", "Reportées", "Annulées", "Sinistrées", "Annulées+sinistre"]);
  });
  it("ignore les paramètres d'URL invalides", () => {
    expect(parsePolicesQuery({ succ: "XX", agence: "abc", statut: "Z", mois: "13" })).toEqual({ succ: "", agence: null, statut: "", mois: null });
    expect(parsePolicesQuery({ succ: "ORAN", agence: "100", statut: "ANNULEE", mois: "7" })).toEqual({ succ: "ORAN", agence: 100, statut: "ANNULEE", mois: 7 });
  });
});
