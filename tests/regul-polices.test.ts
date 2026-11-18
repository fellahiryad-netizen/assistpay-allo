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

import { decouperFichier, fusionnerFichier, lireFichier } from "@/features/regul/services/regul-polices";

describe("croiserPolices : cas limites", () => {
  const imm = (n: string): string => `${n}-116-16`;
  const run = (b: BaseRow[], f: RegulFichier[]) => croiserPolices("ORAN", b, f, null, {}, { mois: [7] });

  it("une régularisation antérieure seule n'est pas une report", () => {
    const r = run([base(7, 100, "P1/0", imm("111111"))], [fichier(7, [[100, "P9", imm("999999"), 0, 1, 0]]), fichier(6, [[100, "P1", imm("111111"), 0, 500, 0]])]);
    expect(r.absentes[0]?.statut).toBe("INTROUVABLE");
  });
  it("flotte mensuelle : présente chaque mois au consolidé et en régul sauf ce mois, introuvable", () => {
    const r = run([base(7, 100, "F1/0", imm("123123")), base(8, 100, "F1/0", imm("123123"))], [fichier(7, [[100, "P9", imm("999999"), 0, 1, 0]]), fichier(8, [[100, "F1", imm("123123"), 0, 500, 0]])]);
    expect(r.absentes[0]?.statut).toBe("INTROUVABLE");
  });
  it("réapparition au consolidé avec une autre part assisteur : reportée probable", () => {
    const r = run([base(7, 100, "P3/0", imm("333333")), base(9, 100, "P3/0", imm("333333"), 1000, 700)], [fichier(7, [[100, "P9", imm("999999"), 0, 1, 0]])]);
    expect(r.absentes[0]?.statut).toBe("REPORTEE_PROBABLE");
    expect(compterParAgence(r)[0]?.reporteesProbables).toBe(1);
    expect(filtrerStatut(r, "REPORTEE_PROBABLE").absentes).toHaveLength(1);
    expect(parsePolicesQuery({ statut: "REPORTEE_PROBABLE" }).statut).toBe("REPORTEE_PROBABLE");
  });
  it("changement de garantie (+300 / -100, produits différents) : introuvable avec mention, pas annulée", () => {
    const b: BaseRow[] = [[7, 100, "G1/0", imm("555000"), 1, 300, 150], [7, 100, "G1/0", imm("555000"), 2, -100, -50]];
    const r = run(b, [fichier(7, [[100, "P9", imm("999999"), 0, 1, 0]])]);
    expect(r.absentes[0]?.statut).toBe("INTROUVABLE");
    expect(r.absentes[0]?.remarque).toBe("changement de garantie possible");
    expect(r.absentes[0]?.annulee).toBe(false);
    expect(r.annulees).toHaveLength(0);
  });
  it("une négative d'un autre mois ne rend pas annulée", () => {
    const r = run([base(7, 100, "N1/0", imm("777000")), base(8, 100, "N1/0", imm("777000"), -1000, -500)], [fichier(7, [[100, "P9", imm("999999"), 0, 1, 0]])]);
    expect(r.absentes[0]?.statut).not.toBe("ANNULEE");
  });
  it("immatriculation illisible : présente seulement si la régul compte autant de lignes que l'avance", () => {
    const b = [base(7, 100, "Z1/0", "?"), base(7, 100, "Z1/0", "??")];
    expect(run(b, [fichier(7, [[100, "Z1", "", 0, 1, 0]])]).absentes.length).toBeGreaterThan(0);
    expect(run(b, [fichier(7, [[100, "Z1", "", 0, 1, 0], [100, "Z1", "", 0, 1, 0]])]).absentes).toHaveLength(0);
  });
});

describe("fusion et rechargement partiel", () => {
  const f = (names: string[], rows: RegulFichier["rows"], origine: number[], produits = ["Rapide"]): RegulFichier => ({ ...fichier(7, rows), fichiers: names, produits, origine });
  it("conserve les fichiers absents du nouvel envoi et remplace ceux rechargés", () => {
    const old = f(["A.xlsx", "B.xlsx"], [[100, "P1", "111111-116-16", 0, 1, 0], [100, "P2", "222222-116-16", 0, 1, 0]], [0, 1]);
    const neu = f(["B.xlsx"], [[100, "P3", "333333-116-16", 0, 1, 0]], [0]);
    const out = fusionnerFichier(old, neu, false);
    expect(out.conserves).toEqual(["A.xlsx"]);
    expect(out.fichier.rows.map((r) => r[1]).sort()).toEqual(["P1", "P3"]);
    expect(out.fichier.fichiers.sort()).toEqual(["A.xlsx", "B.xlsx"]);
  });
  it("fusionne les lots d'un même chargement sans rien remplacer, et remappe les produits", () => {
    const lots = decouperFichier(f(["A.xlsx"], [[100, "P1", "111111-116-16", 0, 1, 0], [100, "P2", "222222-116-16", 1, 1, 0], [100, "P3", "333333-116-16", 1, 1, 0]], [0, 0, 0], ["Rapide", "Gold"]), 2);
    expect(lots).toHaveLength(2);
    const first = fusionnerFichier(null, lots[0] as RegulFichier, false).fichier;
    const second = fusionnerFichier(first, lots[1] as RegulFichier, true).fichier;
    expect(second.rows).toHaveLength(3);
    expect(second.produits.sort()).toEqual(["Gold", "Rapide"]);
  });
  it("ancien enregistrement sans origine : signalé, jamais mélangé", () => {
    const old: RegulFichier = { ...fichier(7, [[100, "P1", "111111-116-16", 0, 1, 0]]), fichiers: ["A.xlsx"] };
    const out = fusionnerFichier(old, f(["B.xlsx"], [[100, "P2", "222222-116-16", 0, 1, 0]], [0]), false);
    expect(out.perdus).toEqual(["A.xlsx"]);
    expect(out.fichier.rows).toHaveLength(1);
  });
  it("lireFichier ignore une forme inconnue sans planter", () => {
    expect(lireFichier(null)).toBeNull();
    expect(lireFichier({ succ: "ORAN" })).toBeNull();
    expect(lireFichier({ ...fichier(7, [[100, "P1", "x", 0, 1, 9 as never]]) })).toBeNull();
    expect(lireFichier(fichier(7, [[100, "P1", "x", 0, 1, 0]]))?.rows).toHaveLength(1);
  });
  it("tronque les cellules parasites au lieu de les rejeter", () => {
    const out = buildFichiers("ORAN", 2026, { valid: [line({ bp: "P".repeat(200), immat: "I".repeat(200) })], annul: [], garan: [] }, "");
    expect(out[0]?.rows[0]?.[1]).toHaveLength(80);
    expect(out[0]?.rows[0]?.[2]).toHaveLength(80);
  });
});

describe("volume", () => {
  it("60 000 lignes de base et de régularisation en moins de 2 s", () => {
    const n = 60000;
    const b: BaseRow[] = [];
    const rows: RegulFichier["rows"] = [];
    for (let i = 0; i < n; i++) {
      b.push(base(7, 100 + (i % 5), `P${i}/0`, `${100000 + i}-116-16`));
      if (i % 3) rows.push([100 + (i % 5), `P${i}`, `${100000 + i}-116-16`, 0, 500, 0]);
    }
    const t = Date.now();
    const lines = rows.map((r, i) => line({ bp: r[1], immat: r[2], code: r[0], fichier: i % 2 ? "a.xlsx" : "b.xlsx" }));
    buildFichiers("ORAN", 2026, { valid: lines, annul: [], garan: [] }, "");
    const res = croiserPolices("ORAN", b, [fichier(7, rows)], null, {}, { mois: [7] });
    expect(res.absentes).toHaveLength(n / 3);
    expect(Date.now() - t).toBeLessThan(2000);
  });
});
