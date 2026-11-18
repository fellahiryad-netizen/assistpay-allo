import { describe, expect, it } from "vitest";
import { analyseNumbering, extractMotif, formatSeriesNumber, parseNumbers } from "@/features/numbering/lib/numbering-analysis";
import type { NumberSource } from "@/features/numbering/types";

const src = (raw: string, docKey: string, origin: NumberSource["origin"] = "suivi"): NumberSource => ({ raw, docKey, origin, label: docKey });

describe("parseNumbers : formats actuels", () => {
  it("suite commune", () => {
    expect(parseNumbers("GAM 26-000057")).toMatchObject([{ kind: "FACT", year: 2026, seq: 57, prefix: "GAM" }]);
    expect(parseNumbers("CAAR26-000012")).toMatchObject([{ kind: "FACT", seq: 12, prefix: "CAAR" }]);
    expect(parseNumbers("Trust 26-000003")).toMatchObject([{ kind: "FACT", prefix: "TRUST" }]);
  });
  it("ignore les numéros de reprise à partir de 5000 et les numéros sans préfixe", () => {
    expect(parseNumbers("GAM 26-005000")).toEqual([]);
    expect(parseNumbers("123456")).toEqual([]);
  });
  it("BDG GAM, TRUST, CAAT (avec paire) et avoir", () => {
    expect(parseNumbers("000019-2026 AB")).toMatchObject([{ kind: "AB", year: 2026, seq: 19 }]);
    expect(parseNumbers("AB 018-2026")).toMatchObject([{ kind: "AB", seq: 18 }]);
    expect(parseNumbers("TRUST 000012-2026 BDG")).toMatchObject([{ kind: "TRUST_BDG", seq: 12 }]);
    expect(parseNumbers("TRUST 000012-2026 BDG & TRUST 000013-2026 BDG").map((n) => n.seq)).toEqual([12, 13]);
    expect(parseNumbers("CAAT26-155&156BDG")).toMatchObject([{ kind: "CAAT_BDG", seq: 155 }, { kind: "CAAT_BDG", seq: 156 }]);
    expect(parseNumbers("CAAT 26-000041BDG")).toMatchObject([{ kind: "CAAT_BDG", seq: 41 }]);
    expect(parseNumbers("AV/2026/0007")).toMatchObject([{ kind: "AVOIR", year: 2026, seq: 7 }]);
  });
  it("un numéro BDG n'est jamais pris pour la suite commune", () => {
    expect(parseNumbers("CAAT 26-000041BDG").every((n) => n.kind === "CAAT_BDG")).toBe(true);
    expect(parseNumbers("TRUST 000012-2026 BDG").every((n) => n.kind === "TRUST_BDG")).toBe(true);
  });
  it("lit un numéro au milieu d'une ligne de journal", () => {
    expect(parseNumbers("Client – GAM ASSURANCE GAM 26-000045 – 12 000,00 DA")).toMatchObject([{ kind: "FACT", seq: 45, prefix: "GAM" }]);
  });
});

describe("analyseNumbering : séries, trous, doublons", () => {
  it("dernier numéro, nombre émis et trous (suite commune tous partenaires confondus)", () => {
    const r = analyseNumbering([src("GAM 26-000001", "a"), src("TRUST 26-000002", "b"), src("GAM 26-000005", "c"), src("MLA 26-000006", "d")], []);
    const serie = r.series[0];
    expect(r.series).toHaveLength(1);
    expect(serie).toMatchObject({ kind: "FACT", year: 2026, count: 4, last: 6, nextSeq: 7, gapCount: 2, unexplainedGapCount: 2 });
    expect(serie?.gaps).toMatchObject([{ from: 3, to: 4, count: 2, explained: false }]);
    expect(serie?.partners.map((p) => `${p.prefix}:${p.count}`)).toEqual(["GAM:2", "MLA:1", "TRUST:1"]);
  });
  it("séparation par année et par famille", () => {
    const r = analyseNumbering([src("GAM 25-000010", "a"), src("GAM 26-000001", "b"), src("000001-2026 AB", "c"), src("AV/2026/0001", "d", "avoir")], []);
    expect(r.series.map((s) => s.key)).toEqual(["FACT:2026", "AB:2026", "AVOIR:2026", "FACT:2025"]);
    expect(r.years).toEqual([2026, 2025]);
  });
  it("une facture du suivi et sa facture établie ne forment pas un doublon", () => {
    const r = analyseNumbering([src("GAM 26-000001", "inv:1"), src("GAM 26-000001", "inv:1", "etablie")], []);
    expect(r.series[0]?.duplicates).toEqual([]);
    expect(r.series[0]?.documents).toBe(1);
  });
  it("deux documents différents avec le même numéro : doublon", () => {
    const r = analyseNumbering([src("GAM 26-000001", "inv:1"), src("CAAT 26-000001", "inv:2")], []);
    expect(r.series[0]?.duplicates).toHaveLength(1);
    expect(r.totals.duplicates).toBe(1);
  });
  it("trou avant le premier numéro signalé comme tel", () => {
    const r = analyseNumbering([src("GAM 26-000004", "a")], []);
    expect(r.series[0]?.gaps).toMatchObject([{ from: 1, to: 3, beforeFirst: true }]);
  });
  it("numéros hors séries listés à part", () => {
    const r = analyseNumbering([src("FACT N° 12", "a"), src("", "b")], []);
    expect(r.series).toEqual([]);
    expect(r.unrecognised).toHaveLength(1);
  });
  it("paire BDG CAAT : les deux numéros comptent", () => {
    const r = analyseNumbering([src("CAAT26-1&2BDG", "a"), src("CAAT26-3&4BDG", "b")], []);
    expect(r.series[0]).toMatchObject({ kind: "CAAT_BDG", count: 4, gapCount: 0, last: 4 });
  });
});

describe("analyseNumbering : numéros de factures supprimées", () => {
  const base = [src("GAM 26-000001", "a"), src("GAM 26-000002", "b"), src("GAM 26-000004", "d")];
  it("numéro supprimé au milieu : trou expliqué, libre définitif", () => {
    const r = analyseNumbering(base, [{ text: "Client – GAM GAM 26-000003 – 1 000,00 DA – motif : erreur de saisie", at: "2026-10-01T08:00:00.000Z", by: "Amel", motif: "erreur de saisie", origin: "journal" }]);
    const s = r.series[0];
    expect(s?.gaps).toMatchObject([{ from: 3, to: 3, explained: true }]);
    expect(s?.unexplainedGapCount).toBe(0);
    expect(s?.freed).toMatchObject([{ seq: 3, status: "libre_trou", deletion: { by: "Amel", motif: "erreur de saisie" } }]);
  });
  it("numéro supprimé en queue : sera redonné automatiquement", () => {
    const r = analyseNumbering(base, [{ text: "GAM 26-000005 – GAM", origin: "journal" }]);
    expect(r.series[0]?.freed).toMatchObject([{ seq: 5, status: "libre_reprise" }]);
    expect(r.totals.freed).toBe(1);
  });
  it("numéro supprimé puis réutilisé", () => {
    const r = analyseNumbering(base, [{ text: "GAM 26-000004", origin: "demande" }]);
    expect(r.series[0]?.freed).toMatchObject([{ seq: 4, status: "reutilise" }]);
    expect(r.totals.freed).toBe(0);
  });
  it("une même suppression tracée deux fois garde la plus récente", () => {
    const r = analyseNumbering(base, [
      { text: "GAM 26-000003", at: "2026-10-01T08:00:00.000Z", by: "A", origin: "journal" },
      { text: "GAM 26-000003", at: "2026-10-02T08:00:00.000Z", by: "B", origin: "demande" },
    ]);
    expect(r.series[0]?.freed).toHaveLength(1);
    expect(r.series[0]?.freed[0]?.deletion.by).toBe("B");
  });
  it("une série entièrement supprimée existe encore dans le registre", () => {
    const r = analyseNumbering([], [{ text: "000003-2026 AB", origin: "journal" }]);
    expect(r.series[0]).toMatchObject({ kind: "AB", count: 0, last: 0 });
    expect(r.series[0]?.freed[0]?.status).toBe("libre_reprise");
  });
});

describe("outils", () => {
  it("motif et mise en forme", () => {
    expect(extractMotif("GAM 26-000003 – motif : doublon")).toBe("doublon");
    expect(extractMotif("GAM 26-000003")).toBeUndefined();
    expect(formatSeriesNumber("AVOIR", 2026, 8)).toBe("AV/2026/0008");
    expect(formatSeriesNumber("AB", 2026, 19)).toBe("000019-2026 AB");
  });
});
