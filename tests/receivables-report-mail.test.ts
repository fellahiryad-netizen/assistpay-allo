import { describe, expect, it } from "vitest";
import { buildImpayesMail, joinFrench, lateBranchesOf, monthName } from "@/features/receivables/lib/report-mail";
import { formatDA } from "@/utils/format";
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
  it("ne garde que les succursales avec des factures de plus de 30 jours, classées par montant, avec montant par mois", () => {
    const late = lateBranchesOf(report, 30);
    expect(late.map((b) => b.label)).toEqual(["Annaba", "Oran"]);
    expect(late[1]).toMatchObject({ count: 2, months: [{ key: "2026-07", amount: 1000 }, { key: "2026-09", amount: 500 }], withoutPeriod: { count: 0, amount: 0 } });
    expect(late[0]).toMatchObject({ count: 2, months: [{ key: "2026-09", amount: 3000 }], withoutPeriod: { count: 1, amount: 100 } });
  });
  it("écrit au féminin, par succursale avec mois et montants, sans nombre de jours", () => {
    const mail = buildImpayesMail(report, 30, "Riad FELLAHI");
    expect(mail.subject).toContain("novembre 2026");
    expect(mail.body.startsWith("Bonjour Madame,")).toBe(true);
    expect(mail.body).toContain(`- Oran, juillet 2026 : ${formatDA(1000)}`);
    expect(mail.body).toContain("afin que vous nous aidiez à débloquer la situation.");
    expect(mail.body).toContain("- Annaba, mois non indiqué :");
    expect(mail.body).not.toMatch(/\d\s*jours?/);
    expect(mail.body).not.toContain("Constantine");
    expect(mail.body.endsWith("Riad FELLAHI\nAllo Assistance")).toBe(true);
  });
  it("cite la direction générale et les productions non reçues", () => {
    const withDirection = buildImpayesReport(detail([
      br("Direction", [{ ...inv("D1", 2000, 60, "2026-06"), libelle: "Refacturation assistance routière passif" }]),
      br("Annaba", [inv("A1", 3000, 70, "2026-09")]),
    ]), "2026-11-26");
    const production = { month: "2026-10", byBranch: { ANNABA: { received: false, last: "2026-09" }, ORAN: { received: true, last: "2026-10" } } };
    const mail = buildImpayesMail(withDirection, 30, "X", { production, labels: { ANNABA: "Annaba", ORAN: "Oran" } });
    expect(mail.body).toContain("Factures de la direction générale (hors mois) :");
    expect(mail.body).toContain("- Refacturation :");
    expect(mail.body).toContain("Productions non reçues :\n- Annaba : production d'octobre 2026");
    expect(mail.productionLate).toEqual(["Annaba"]);
    expect(mail.lateBranches.map((b) => b.label)).toEqual(["Annaba"]);
  });
  it("confirme que tout est à jour quand rien n'est en retard", () => {
    const calm = buildImpayesReport(detail([br("Oran", [inv("O3", 200, 5, "2026-11")])]), "2026-11-26");
    expect(buildImpayesMail(calm, 30, "X").body).toContain("sont à jour");
  });
});

describe("choix « toutes les factures impayées »", () => {
  it("cite aussi les factures récentes quand le filtre est à 0", () => {
    const r = buildImpayesReport(detail([br("Chéraga", [inv("C1", 6310417.63, 4, "2026-10")]), br("Annaba", [inv("A1", 3321009.05, 2, "2026-09")])]), "2026-11-26");
    expect(lateBranchesOf(r, 30)).toHaveLength(0);
    const mail = buildImpayesMail(r, 0, "X");
    expect(mail.body).toContain("- Chéraga, octobre 2026 :");
    expect(mail.body).toContain("- Annaba, septembre 2026 :");
  });
});

describe("mois déduits du libellé et régularisations", () => {
  it("retrouve le mois dans le libellé et met la régularisation à part", () => {
    const l = (id: string, libelle: string, periode: string, amount: number, age: number): DetailInvoice => ({ ...inv(id, amount, age, periode), libelle });
    const r = buildImpayesReport(detail([
      br("Succursale Cheraga", [l("C1", "Honoraire – Mois de SEPTEMBRE 2026 — Succursale CHERAGA", "", 7133560.06, 38), l("C2", "Facturation mois de OCTOBRE 2026", "2026-10", 6310417.63, 4)]),
      br("Succursale Annaba", [l("A1", "FACTURATION MOIS DE AOUT2026", "", 2880540.27, 60), l("A2", "Facturation mois de SEPTEMBRE 2026", "2026-09", 3321009.05, 2)]),
      br("Succursale Oran", [l("O1", "Régul 10 % mai, juin et juillet 2026 succursale Oran", "2026-07", 2756586.26, 11), l("O2", "Facturation mois de OCTOBRE 2026", "2026-10", 2841760.23, 3)]),
    ]), "2026-11-26");
    const body = buildImpayesMail(r, 0, "X").body;
    expect(body).toContain("- Cheraga, septembre 2026 :".replace("Cheraga", "Succursale Cheraga"));
    expect(body).toContain("Succursale Cheraga, octobre 2026");
    expect(body).toContain("Succursale Annaba, août 2026");
    expect(body).toContain("Succursale Annaba, septembre 2026");
    expect(body).toContain("Succursale Oran, octobre 2026");
    expect(body).not.toContain("Succursale Oran, juillet 2026");
    expect(body).toContain("Succursale Oran, régularisation");
    expect(body).not.toContain("mois non indiqué");
  });
});
