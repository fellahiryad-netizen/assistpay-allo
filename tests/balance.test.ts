import { describe, expect, it } from "vitest";
import { isSplit, remaining, settle, type PayableInvoice } from "@/features/invoices/services/invoice-balance";

function invoice(patch: Partial<PayableInvoice> = {}): PayableInvoice {
  return {
    id: "i1", legacyId: "r1", sens: "CREDIT", status: "EN_ATTENTE", categorie: "BDG CAAT", tiers: "ALLO", numero: "N1", libelle: "", montant: 1000, montantGlobal: null,
    debours: 0, frais: 0, dateFacture: null, dateOperation: null, cheque: "", succursale: "", payroll: false, origine: "", paymentRefs: [], extra: {}, ...patch,
  };
}
const virement = { date: "2026-11-04", mode: "VIREMENT" as const, numero: "" };

describe("soldes et règlements", () => {
  it("une facture simple en attente reste due en entier", () => {
    expect(remaining(invoice())).toBe(1000);
    expect(isSplit(invoice())).toBe(false);
  });

  it("une facture réglée ou annulée ne doit plus rien", () => {
    expect(remaining(invoice({ status: "REGLE" }))).toBe(0);
    expect(remaining(invoice({ status: "ANNULE" }))).toBe(0);
  });

  it("une facture BDG se règle en deux parties", () => {
    const bdg = invoice({ montant: 5435384.5, debours: 5302104.5, frais: 133280 });
    expect(isSplit(bdg)).toBe(true);
    expect(remaining(bdg)).toBe(5435384.5);
    const first = settle(bdg, "debours", virement);
    expect(first.status).toBe("EN_ATTENTE");
    expect(first.extra.regDebours).toBe("2026-11-04");
    const afterDebours = invoice({ ...bdg, extra: first.extra });
    expect(remaining(afterDebours)).toBe(133280);
    const second = settle(afterDebours, "frais", virement);
    expect(second.status).toBe("REGLE");
    expect(second.dateOperation).toBe("2026-11-04");
  });

  it("règle les deux parties d'un coup avec « tout »", () => {
    const bdg = invoice({ montant: 300, debours: 200, frais: 100 });
    const result = settle(bdg, "tout", virement);
    expect(result.status).toBe("REGLE");
    expect(result.extra.regDebours).toBe("2026-11-04");
    expect(result.extra.regFrais).toBe("2026-11-04");
  });

  it("un paiement partiel garde la facture en attente puis la solde", () => {
    const base = invoice({ montant: 1000 });
    const part = settle(base, "tout", virement, 400);
    expect(part.status).toBe("EN_ATTENTE");
    expect(remaining(invoice({ extra: part.extra }))).toBe(600);
    const rest = settle(invoice({ extra: part.extra }), "tout", virement, 600);
    expect(rest.status).toBe("REGLE");
  });

  it("un paiement complet solde une facture simple", () => {
    expect(settle(invoice(), "tout", virement, 1000).status).toBe("REGLE");
  });
});
