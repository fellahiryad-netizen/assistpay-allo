import { describe, expect, it } from "vitest";
import { buildImpayesReport, branchHeadline, millions } from "@/features/receivables/lib/report";
import type { DetailBranch, DetailInvoice, ReceivableDetail } from "@/features/receivables/types";

const invoice = (id: string, amount: number, ageDays: number | null, aging: DetailInvoice["aging"]): DetailInvoice => ({ id, numero: id, libelle: "", periode: "2026-01", date: ageDays === null ? null : "2026-01-01", ageDays, aging, amount, partner: "caar", lastReminder: null });
const branch = (label: string, invoices: DetailInvoice[]): DetailBranch => ({ label, branchKey: label, amount: invoices.reduce((s, i) => s + i.amount, 0), count: invoices.length, share: 0, oldestDays: Math.max(0, ...invoices.map((i) => i.ageDays ?? 0)), oldestDate: null, lastReminder: null, partners: [], invoices });
const detail = (branches: DetailBranch[]): ReceivableDetail => ({ scope: { company: "CAAR", activity: null }, scopeTotal: 0, scopeCount: 0, minAge: null, total: 0, count: 0, branches });

describe("rapport des impayés", () => {
  const data = detail([
    branch("Oran", [invoice("O1", 3000, 120, "D90_PLUS"), invoice("O2", 1000, 10, "D0_30")]),
    branch("Annaba", [invoice("A1", 6000, 100, "D90_PLUS"), invoice("A2", 500, null, "SANS_DATE")]),
  ]);
  const report = buildImpayesReport(data, "2026-11-26");
  it("additionne et classe les succursales par montant", () => {
    expect(report.total).toBe(10500);
    expect(report.count).toBe(4);
    expect(report.branches.map((b) => b.label)).toEqual(["Annaba", "Oran"]);
    expect(report.branches.reduce((s, b) => s + b.share, 0)).toBeCloseTo(100, 5);
  });
  it("calcule la part de plus de 90 jours et l'ancienneté pondérée", () => {
    expect(report.over90).toEqual({ amount: 9000, count: 2, share: 85.7 });
    expect(report.weightedAgeDays).toBe(Math.round((3000 * 120 + 1000 * 10 + 6000 * 100) / 10000));
    expect(report.undated).toEqual({ amount: 500, count: 1 });
  });
  it("classe les plus anciennes d'abord et ignore les factures sans date", () => {
    expect(report.oldest.map((i) => i.id)).toEqual(["O1", "A1", "O2"]);
    expect(report.aging.reduce((s, a) => s + a.share, 0)).toBeCloseTo(100, 5);
  });
  it("écrit des phrases de synthèse", () => {
    expect(report.headline).toContain("4 facture(s) CAAR");
    expect(branchHeadline(report.branches[0]!)).toContain("de plus de 90 jours");
    expect(millions(281_900_759.14)).toMatch(/^281,9\s*M DA$/);
  });
  it("gère l'absence de facture", () => {
    expect(buildImpayesReport(detail([]), "2026-11-26").headline).toContain("aucune facture");
  });
});
