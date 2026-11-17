import { describe, expect, it } from "vitest";
import { findCombinations, type CumulPart } from "@/features/invoices/lib/cumul";

const part = (id: string, da: number): CumulPart => ({ id, numero: id, cents: Math.round(da * 100) });

describe("findCombinations", () => {
  const list = [part("A", 1000000), part("B", 1550170), part("C", 300), part("D", 77)];
  it("trouve deux factures dont la somme égale le virement", () => {
    const found = findCombinations(list, { lo: 255017000, hi: 255017000 });
    expect(found.map((group) => group.map((p) => p.id))).toEqual([["A", "B"]]);
  });
  it("sans décimales, accepte toute la plage en centimes", () => {
    const found = findCombinations([part("A", 1000000.4), part("B", 1550169.9)], { lo: 255017000, hi: 255017099 });
    expect(found).toHaveLength(1);
  });
  it("trouve trois factures", () => {
    expect(findCombinations([part("A", 100), part("B", 200), part("C", 300)], { lo: 60000, hi: 60000 })).toHaveLength(1);
  });
  it("ne renvoie rien si aucune somme ne correspond", () => {
    expect(findCombinations(list, { lo: 12345, hi: 12345 })).toEqual([]);
  });
});
