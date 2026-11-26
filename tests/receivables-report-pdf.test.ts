import { describe, expect, it } from "vitest";
import { jsPDF } from "jspdf";
import { buildImpayesReport } from "@/features/receivables/lib/report";
import { drawImpayesReport } from "@/features/receivables/lib/report-pdf";
import type { DetailBranch, DetailInvoice, ReceivableDetail } from "@/features/receivables/types";

const invoice = (i: number, amount: number, age: number): DetailInvoice => ({ id: `i${i}`, numero: `CAAR26-${String(i).padStart(6, "0")}`, libelle: "", periode: "2026-0" + ((i % 9) + 1), date: "2026-03-01", ageDays: age, aging: age > 90 ? "D90_PLUS" : age > 60 ? "D61_90" : age > 30 ? "D31_60" : "D0_30", amount, partner: "caar", lastReminder: null });
const branch = (label: string, n: number): DetailBranch => {
  const invoices = Array.from({ length: n }, (_, i) => invoice(i + 1, 100000 + i * 12345.67, 20 + i * 15));
  return { label, branchKey: label, amount: invoices.reduce((s, x) => s + x.amount, 0), count: n, share: 0, oldestDays: 20 + (n - 1) * 15, oldestDate: "2026-03-01", lastReminder: null, partners: [], invoices };
};

describe("PDF du rapport des impayés", () => {
  it("tient en 3 pages au plus", () => {
    const detail: ReceivableDetail = { scope: { company: "CAAR", activity: null }, scopeTotal: 0, scopeCount: 0, minAge: null, total: 0, count: 0, branches: [branch("Alger Chéraga", 5), branch("Oran", 20), branch("Annaba", 3)] };
    const report = buildImpayesReport(detail, "2026-11-26");
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const pages = drawImpayesReport(doc, report, { logo: null, footer: null, company: null }, "2026-11-26T10:00:00Z");
    // synthèse + détail : jamais plus de 3 pages, même avec beaucoup de factures
    expect(pages).toBe(2);
    expect(doc.getNumberOfPages()).toBe(2);
    expect(doc.output("arraybuffer").byteLength).toBeGreaterThan(5000);
  });
});

describe("production M-1 et factures de la direction", () => {
  it("repère la production du mois précédent non reçue", async () => {
    const { productionStatusOf, directionNature } = await import("@/features/receivables/lib/report");
    const status = productionStatusOf(
      [
        { annee: 2026, mois: 9, succursale: "Annaba" },
        { annee: 2026, mois: 10, succursale: "Oran" },
      ],
      "2026-11-26",
      ["ANNABA", "ORAN", "CHERAGA"],
    );
    expect(status.month).toBe("2026-10");
    expect(status.byBranch.ANNABA).toEqual({ received: false, last: "2026-09" });
    expect(status.byBranch.ORAN).toEqual({ received: true, last: "2026-10" });
    expect(status.byBranch.CHERAGA).toEqual({ received: false, last: null });
    expect(productionStatusOf([], "2027-01-05", []).month).toBe("2026-12");
    expect(directionNature("Refacturation assistance routière passif – 349 dossiers")).toBe("Refacturation");
    expect(directionNature("Régularisation des polices passives – Direction CAAR")).toBe("Facture client, janvier à avril");
    expect(directionNature("Honoraire – Mois de SEPTEMBRE 2026")).toBeNull();
  });

  it("produit 3 pages avec le tableau de paiement et beaucoup de factures", () => {
    const many: DetailInvoice[] = Array.from({ length: 40 }, (_, i) => invoice(i + 1, 50000 + i, 10 + i));
    const detail: ReceivableDetail = { scope: { company: "CAAR", activity: null }, scopeTotal: 0, scopeCount: 0, minAge: null, total: 0, count: 0, branches: [branch("Annaba", 3), { ...branch("Oran", 1), invoices: many, count: 40, amount: 40 * 50000 }] };
    const report = buildImpayesReport(detail, "2026-11-26");
    const cell = (state: "vide" | "attente" | "regle", due: number) => ({ invoices: [], billed: due, paid: 0, due, state });
    const row = (key: string, label: string, due: number) => ({ key, label, months: Array.from({ length: 12 }, (_, m) => cell(m === 5 ? "attente" : "vide", m === 5 ? due : 0)), other: cell("vide", 0), billed: due, paid: 0, due });
    const grid = { client: "CAAR" as const, year: 2026, years: [2026], rows: [row("ANNABA", "Annaba", 812345), row("ORAN", "Oran", 450000)], totals: { months: Array.from({ length: 12 }, () => ({ billed: 0, paid: 0, due: 0 })), other: { billed: 0, paid: 0, due: 0 }, billed: 0, paid: 0, due: 1262345 } };
    const production = { month: "2026-10", byBranch: { ANNABA: { received: false, last: "2026-09" }, ORAN: { received: true, last: "2026-10" } } };
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    expect(drawImpayesReport(doc, report, { logo: null, footer: null, company: null }, "2026-11-26T10:00:00Z", { grid, production })).toBe(3);
  });
});
