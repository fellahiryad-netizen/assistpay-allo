import { describe, expect, it } from "vitest";
import { explainGap, type GapRow } from "@/features/caar/services/caar-gap";

const row = (line: number, prime: number | null, flags: string[] = [], include = true): GapRow => ({ line, agence: "A1", police: `P${line}`, nom: "X", prime, include, flags });

describe("explainGap", () => {
  it("renvoie null sans écart ou sans total déclaré", () => {
    expect(explainGap([row(2, 100)], 100, 5, 100)).toBeNull();
    expect(explainGap([row(2, 100)], null, null, 100)).toBeNull();
  });
  it("explique un écart par les lignes Tunisie exclues", () => {
    const rows = [row(2, 1000), row(3, 500, ["TUNISIE"], false), row(4, 1500, ["TOTAL"], false)];
    const gap = explainGap(rows, 1500, 4, 1000);
    expect(gap?.gap).toBe(-500);
    expect(gap?.causes[0]?.key).toBe("TUNISIE");
    expect(gap?.conclusion).toContain("exactement");
  });
  it("explique un écart par un doublon retenu", () => {
    const rows = [row(2, 1000), row(3, 1000, ["DUP"]), row(4, 1000, ["TOTAL"], false)];
    const gap = explainGap(rows, 1000, 4, 2000);
    expect(gap?.gap).toBe(1000);
    expect(gap?.conclusion).toContain("double");
  });
  it("signale une ligne dont la prime égale l'écart", () => {
    const rows = [row(2, 700), row(3, 300), row(4, 5000, ["TOTAL"], false)];
    const gap = explainGap(rows, 700, 4, 1000);
    expect(gap?.singleLines.map((r) => r.line)).toEqual([3]);
  });
});
