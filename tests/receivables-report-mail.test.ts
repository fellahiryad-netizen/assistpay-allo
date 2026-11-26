import { describe, expect, it } from "vitest";
import { buildImpayesMail, joinFrench, lateBranchesOf, monthName } from "@/features/receivables/lib/report-mail";
import { buildImpayesReport } from "@/features/receivables/lib/report";
import type { DetailBranch, DetailInvoice, ReceivableDetail } from "@/features/receivables/types";

const inv = (id: string, amount: number, ageDays: number | null, periode: string): DetailInvoice => ({ id, numero: id, libelle: "", periode, date: null, ageDays, aging: "D0_30", amount, partner: "caar", lastReminder: null });
const br = (label: string, invoices: DetailInvoice[]): DetailBranch => ({ label, branchKey: label, amount: invoices.reduce((s, i) => s + i.amount, 0), count: invoices.length, share: 0, oldestDays: null, oldestDate: null, lastReminder: null, partners: [], invoices });
const detail = (branches: DetailBranch[]): ReceivableDetail => ({ scope: { company: "CAAR", activity: null }, scopeTotal: 0, scopeCount: 0, minAge: null, total: 0, count: 0, branches });

describe("mail des impayés à la direction", () => {
  const report = buildImpayesReport(detail([
    br("Oran", [inv("O1", 1000, 120, "2026-07"), inv("O2", 500, 45, "2026-09"), inv("O3", 200, 5, "2026-11")]),
    br("Annaba", [inv("A1", 3000, 70, "2026-09"), inv("A2", 100, 90, "")]),
    br("Constantine", [inv("C1", 50, 10, "2026-10")]),
  ]), "2026-11-26");
  it("met en forme les mois", () => {
    expect(monthName("2026-09")).toBe("septembre 2026");
    expect(monthName("n'importe quoi")).toBe("");
    expect(joinFrench(["a", "b", "c"])).toBe("a, b et c");
  });
  it("ne garde que les succursales avec des factures de plus de 30 jours, classées par montant", () => {
    const late = lateBranchesOf(report, 30);
    expect(late.map((b) => b.label)).toEqual(["Annaba", "Oran"]);
    expect(late[1]).toMatchObject({ count: 2, months: ["2026-07", "2026-09"], withoutPeriod: 0 });
    expect(late[0]).toMatchObject({ count: 2, months: ["2026-09"], withoutPeriod: 1 });
  });
  it("écrit le mail avec les mois en retard de chaque succursale", () => {
    const mail = buildImpayesMail(report, 30, "Riad FELLAHI");
    expect(mail.subject).toContain("26/11/2026");
    expect(mail.body).toContain("Oran : 2 factures");
    expect(mail.body).toContain("juillet 2026 et septembre 2026");
    expect(mail.body).toContain("1 facture sans mois indiqué");
    expect(mail.body).not.toContain("Constantine");
    expect(mail.body.endsWith("Riad FELLAHI\nAllo Assistance")).toBe(true);
  });
  it("dit qu'aucune succursale n'est en retard quand tout est récent", () => {
    const calm = buildImpayesReport(detail([br("Oran", [inv("O3", 200, 5, "2026-11")])]), "2026-11-26");
    expect(buildImpayesMail(calm, 30, "X").body).toContain("aucune succursale n'est en retard");
  });
});
