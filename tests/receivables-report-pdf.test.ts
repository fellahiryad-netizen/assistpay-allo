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
  it("génère une page par rubrique et pagine l'annexe", () => {
    const detail: ReceivableDetail = { scope: { company: "CAAR", activity: null }, scopeTotal: 0, scopeCount: 0, minAge: null, total: 0, count: 0, branches: [branch("Alger Chéraga", 5), branch("Oran", 20), branch("Annaba", 3)] };
    const report = buildImpayesReport(detail, "2026-11-26");
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const pages = drawImpayesReport(doc, report, { logo: null, footer: null, company: null }, "2026-11-26T10:00:00Z");
    // couverture + vue d'ensemble + succursales + plus anciennes + annexe (1 + 2 + 1)
    expect(pages).toBe(8);
    expect(doc.getNumberOfPages()).toBe(8);
    expect(doc.output("arraybuffer").byteLength).toBeGreaterThan(5000);
  });
});
