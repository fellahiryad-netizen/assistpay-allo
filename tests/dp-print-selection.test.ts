import { describe, expect, it } from "vitest";
import { filterPrintable, printHref, PRINT_MAX, selectedTotal, toggleVisible } from "@/features/payment-requests/lib/print-selection";
import type { DpPrintableDTO } from "@/features/payment-requests/types";

const item = (id: string, beneficiaire: string, montant: number): DpPrintableDTO => ({ id, ref: `${id}/2026AS`, date: null, beneficiaire, montant, produit: "Assistance routière", mode: "VIREMENT", status: "validee", paymentState: "non_payee", paymentLabel: "Non payée" });

describe("sélection d'impression des demandes", () => {
  const items = [item("a1", "BOUSBA MOHAMED", 214542.5), item("b2", "Chébout pare-brise", 100), item("c3", "ABG SERVICE", 50.25)];
  it("cherche sans tenir compte des accents ni de la casse", () => {
    expect(filterPrintable(items, "chebout").map((i) => i.id)).toEqual(["b2"]);
    expect(filterPrintable(items, "  ").length).toBe(3);
    expect(filterPrintable(items, "214542").map((i) => i.id)).toEqual(["a1"]);
  });
  it("additionne les montants cochés", () => {
    expect(selectedTotal(items, new Set(["a1", "c3"]))).toBe(214592.75);
  });
  it("garde l'ordre de la liste dans le lien d'impression", () => {
    expect(printHref(items, new Set(["c3", "a1"]))).toBe("/imprimer/demandes?ids=a1,c3");
  });
  it("limite la sélection à PRINT_MAX", () => {
    const many = Array.from({ length: PRINT_MAX + 5 }, (_, i) => item(`x${i}`, "X", 1));
    const result = toggleVisible(new Set(), many, true);
    expect(result.next.size).toBe(PRINT_MAX);
    expect(result.truncated).toBe(true);
    expect(toggleVisible(result.next, many, false).next.size).toBe(0);
  });
});
