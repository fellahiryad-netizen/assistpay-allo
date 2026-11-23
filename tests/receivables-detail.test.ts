import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildReceivables } from "@/features/receivables/lib/aggregate";
import { AVAILABLE_LOGOS, logoMapOf, logoPathOf } from "@/features/receivables/config/logos";
import { companySlug } from "@/features/receivables/lib/company";
import { buildDetail, inScope, lastReminderOf, parseScope, passesAgeFilter, scopeKey, scopeLabel, toDetailLine, UNKNOWN_BRANCH } from "@/features/receivables/lib/detail";
import { receivablesHref } from "@/features/receivables/lib/links";
import { receivablesQuerySchema } from "@/features/receivables/schemas";
import type { DetailInput } from "@/features/receivables/types";

const TODAY = "2026-11-22";
let seq = 0;
function inv(categorie: string, montant: number, dateFacture: string | null, succursale = "", libelle = "", tiers = ""): DetailInput {
  seq += 1;
  return { id: `d${seq}`, categorie, numero: `F${seq}`, libelle, montant, dateFacture, dateOperation: null, tiers, succursale, periode: "", partner: categorie === "BDG CAAT" ? "CAAT BDG" : categorie };
}
const data = [
  inv("BDG CAAT", 1000.1, "2026-11-01", "ORAN"),
  inv("BDG CAAT", 2500.25, "2026-08-01", "Oran"),
  inv("BDG CAAT", 700.07, "2026-09-10", "", "Facture succursale Annaba octobre"),
  inv("BDG CAAT", 40, null, "", "sans indication"),
  inv("BDG CAAT", 90.9, "2026-10-20", "", "", "ALGER 02"),
  inv("CAAT", 5000, "2026-07-01", "ORAN"),
  inv("GAM", 300, "2026-11-10", "SETIF"),
  inv("GAM BDG", 800, "2026-06-01", "SETIF"),
].map((row) => toDetailLine(row, TODAY));

describe("détail par succursale", () => {
  const scope = { company: "CAAT", activity: "BDG" as const };
  const detail = buildDetail(data, scope, null);
  const cents = (value: number): number => Math.round(value * 100);

  it("ne garde que le périmètre cliqué (compagnie × activité)", () => {
    expect(data.filter((line) => inScope(line, scope))).toHaveLength(5);
    expect(detail.count).toBe(5);
    expect(inScope(data[5]!, { company: "CAAT", activity: null })).toBe(true);
    expect(inScope(data[5]!, scope)).toBe(false);
  });
  it("regroupe par succursale (champ, libellé, tiers) sans doublon de casse", () => {
    expect(detail.branches.map((branch) => branch.label)).toEqual(["Oran", "Annaba", "Alger II", UNKNOWN_BRANCH].sort((a, b) => detail.branches.findIndex((x) => x.label === a) - detail.branches.findIndex((x) => x.label === b)));
    const oran = detail.branches.find((branch) => branch.label === "Oran");
    expect(oran?.count).toBe(2);
    expect(oran?.amount).toBe(3500.35);
    expect(oran?.oldestDate).toBe("2026-08-01");
    expect(oran?.oldestDays).toBe(113);
    expect(detail.branches.find((branch) => branch.label === UNKNOWN_BRANCH)?.count).toBe(1);
  });
  it("tri par montant décroissant (succursales et factures)", () => {
    const amounts = detail.branches.map((branch) => branch.amount);
    expect(amounts).toEqual([...amounts].sort((a, b) => b - a));
    const invoices = detail.branches[0]?.invoices.map((invoice) => invoice.amount) ?? [];
    expect(invoices).toEqual([...invoices].sort((a, b) => b - a));
  });
  it("total du panneau = montant de la ligne cliquée = somme des sous-totaux, au centime", () => {
    const summary = buildReceivables(data, TODAY);
    const caat = summary.companies.find((row) => row.company === "CAAT");
    expect(detail.total).toBe(caat?.byActivity.BDG.amount);
    expect(detail.scopeTotal).toBe(detail.total);
    expect(detail.branches.reduce((sum, branch) => sum + cents(branch.amount), 0)).toBe(cents(detail.total));
    expect(detail.branches.reduce((sum, branch) => sum + branch.invoices.reduce((s, invoice) => s + cents(invoice.amount), 0), 0)).toBe(cents(detail.total));
    expect(detail.total).toBe(4331.32);
    const whole = buildDetail(data, { company: "CAAT", activity: null }, null);
    expect(whole.total).toBe(caat?.amount);
  });
  it("parts en % : somme 100,0", () => {
    expect(Math.round(detail.branches.reduce((sum, branch) => sum + branch.share, 0) * 10)).toBe(1000);
  });
  it("filtre d'ancienneté : plus de N jours ou sans date, total de périmètre conservé", () => {
    expect([passesAgeFilter(31, 30), passesAgeFilter(30, 30), passesAgeFilter(null, 90), passesAgeFilter(5, null)]).toEqual([true, false, true, true]);
    const over60 = buildDetail(data, scope, 60);
    expect(over60.count).toBe(3); // 113 j, 73 j, sans date
    expect(over60.total).toBe(3240.32);
    expect(over60.scopeTotal).toBe(detail.total);
    expect(over60.scopeCount).toBe(5);
    const over90 = buildDetail(data, scope, 90);
    expect(over90.count).toBe(2); // 113 j + sans date
    for (const key of [30, 60, 90]) expect(buildDetail(data, scope, key).total).toBeLessThanOrEqual(detail.total);
  });
  it("périmètre vide", () => {
    const empty = buildDetail(data, { company: "MLA", activity: null }, null);
    expect(empty.branches).toEqual([]);
    expect(empty.total).toBe(0);
  });
});

describe("relances", () => {
  const line = data[0]!;
  it("dernière relance : citant la facture, ou de la succursale, ou du partenaire entier", () => {
    const reminders = [
      { partenaire: "CAAT BDG", sentAt: "2026-10-01T09:00:00.000Z", succursale: "ORAN", factures: [] },
      { partenaire: "CAAT BDG", sentAt: "2026-11-05T09:00:00.000Z", succursale: "ANNABA", factures: [] },
      { partenaire: "CAAT BDG", sentAt: "2026-09-01T09:00:00.000Z", succursale: "", factures: [] },
      { partenaire: "GAM", sentAt: "2026-11-20T09:00:00.000Z", succursale: "", factures: [] },
    ];
    expect(lastReminderOf(reminders, line)).toBe("2026-10-01");
    expect(lastReminderOf(reminders, { ...line, id: "autre", branchKey: "SETIF" })).toBe("2026-09-01");
    expect(lastReminderOf([], line)).toBeNull();
    const withInvoice = [{ partenaire: "CAAT BDG", sentAt: "2026-11-15T00:00:00.000Z", succursale: "ALGER", factures: [line.id] }];
    expect(lastReminderOf(withInvoice, line)).toBe("2026-11-15");
    const detail = buildDetail(data, { company: "CAAT", activity: "BDG" }, null, reminders);
    expect(detail.branches.find((branch) => branch.label === "Oran")?.lastReminder).toBe("2026-10-01");
  });
});

describe("lien partageable", () => {
  it("scopeKey et parseScope font l'aller-retour", () => {
    expect(scopeKey({ company: "CAAT", activity: "BDG" })).toBe("CAAT:BDG");
    expect(parseScope("CAAT:BDG")).toEqual({ company: "CAAT", activity: "BDG" });
    expect(parseScope("caat")).toEqual({ company: "CAAT", activity: null });
    expect(parseScope("AUTO QUAL")).toEqual({ company: "AUTO QUAL", activity: null });
    expect(parseScope("auto qual:autre")).toEqual({ company: "AUTO QUAL", activity: "AUTRE" });
    expect(parseScope("")).toBeNull();
    expect(parseScope(undefined)).toBeNull();
    expect(scopeLabel({ company: "CAAT", activity: "BDG" })).toBe("CAAT · BDG");
  });
  it("l'adresse reprend filtres, détail, ancienneté et ancre", () => {
    expect(receivablesHref({ annee: 2026, activite: "BDG", detail: "CAAT:BDG", anc: 60 }, {}, "detail")).toBe("/creances?annee=2026&activite=BDG&detail=CAAT%3ABDG&anc=60#detail");
    expect(receivablesHref({ detail: "CAAT" }, { detail: undefined })).toBe("/creances");
    const url = new URL(`http://x${receivablesHref({ detail: "CAAT:BDG", anc: 90 })}`);
    const parsed = receivablesQuerySchema.parse(Object.fromEntries(url.searchParams));
    expect(parsed.detail).toBe("CAAT:BDG");
    expect(parsed.anc).toBe(90);
  });
  it("paramètres invalides ignorés", () => {
    expect(receivablesQuerySchema.parse({ anc: "45", annee: "abc", activite: "X" })).toEqual({});
  });
});

describe("logos", () => {
  it("chaque logo annoncé existe dans public/partenaires, TPA et AUTO QUAL n'en ont pas", () => {
    expect([...AVAILABLE_LOGOS].sort()).toEqual(["caar", "caat", "gam", "mla", "trust"]);
    for (const slug of AVAILABLE_LOGOS) expect(existsSync(`public/partenaires/${slug}.png`)).toBe(true);
    expect(logoPathOf("caat")).toBe("/partenaires/caat.png");
    expect(logoPathOf("tpa")).toBeNull();
    expect(logoPathOf(companySlug("AUTO QUAL"))).toBeNull();
  });
  it("table des logos par compagnie", () => {
    expect(logoMapOf(["CAAT", "TPA", "TRUST", "Autres"], companySlug)).toEqual({ CAAT: "/partenaires/caat.png", TRUST: "/partenaires/trust.png" });
  });
});
