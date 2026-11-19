import { describe, expect, it } from "vitest";
import { changeProviderActivitySchema, invoiceInputSchema } from "@/features/invoices/schemas";

const base = { sens: "DEBIT", tiers: "Garage A", montant: 1000, dateFacture: "2026-11-01" };

describe("validation de l'activité", () => {
  it("est obligatoire pour une facture fournisseur", () => {
    const result = invoiceInputSchema.safeParse(base);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(["activite"]);
  });
  it("accepte assistance, bdg, autre et refuse le reste", () => {
    for (const activite of ["assistance", "bdg", "autre"]) expect(invoiceInputSchema.safeParse({ ...base, activite }).success).toBe(true);
    expect(invoiceInputSchema.safeParse({ ...base, activite: "tva" }).success).toBe(false);
  });
  it("n'est pas demandée pour une facture partenaire", () => {
    expect(invoiceInputSchema.safeParse({ ...base, sens: "CREDIT" }).success).toBe(true);
  });
  it("le changement d'activité refuse une activité identique", () => {
    expect(changeProviderActivitySchema.safeParse({ tiers: "A", from: "bdg", to: "bdg", expected: 2 }).success).toBe(false);
    expect(changeProviderActivitySchema.safeParse({ tiers: "A", from: "bdg", to: "assistance", expected: 2 }).success).toBe(true);
  });
});
