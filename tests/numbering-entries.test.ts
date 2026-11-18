import { describe, expect, it } from "vitest";
import { analyseNumbering } from "@/features/numbering/lib/numbering-analysis";

describe("registre de numérotation : numéros existants (recherche)", () => {
  it("liste chaque numéro existant avec le document qui le porte", () => {
    const result = analyseNumbering(
      [
        { raw: "000020-2026 AB", docKey: "a", origin: "etablie", label: "GAM Conv" },
        { raw: "000022-2026 AB", docKey: "b", origin: "etablie", label: "GAM Takaful" },
      ],
      [],
    );
    const series = result.series.find((item) => item.kind === "AB");
    expect(series?.entries.map((entry) => entry.seq)).toEqual([20, 22]);
    expect(series?.entries[1]?.docs[0]?.label).toBe("GAM Takaful");
  });
});
