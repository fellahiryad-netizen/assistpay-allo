import { describe, expect, it } from "vitest";
import { chequesInCirculation, type BankDebit, type IssuedCheque } from "@/features/treasury/lib/circulation";
import { computeTreasury, type ComputeInput } from "@/features/treasury/lib/compute";
import { invoiceNature, priorityGroups, priorityOrder, type PayableItem } from "@/features/treasury/lib/payables";
import { expectedCollections, delayStats, companyOf, median, percentile, type PendingReceivable, type SettledInput } from "@/features/treasury/lib/receivables";
import { buildTimeline, buildVerdict, cushionAmount, riskLevel, spendingReference } from "@/features/treasury/lib/risk";
import type { MonthlyFlow, ResolvedBalance, SimLine } from "@/features/treasury/types";

const monthly: MonthlyFlow[] = [
  { m: "2026-04", credit: 0, debit: 91_784_489.6 },
  { m: "2026-05", credit: 0, debit: 50_581_688.14 },
  { m: "2026-06", credit: 0, debit: 122_851_964.53 },
  { m: "2026-07", credit: 0, debit: 56_873_216.92 },
  { m: "2026-08", credit: 0, debit: 106_118_236.54 },
  { m: "2026-09", credit: 0, debit: 103_467_686.16 },
  { m: "2026-10", credit: 0, debit: 82_103_511.35 },
  { m: "2026-11", credit: 0, debit: 32_994_025.58 },
];

describe("réserve conseillée", () => {
  it("moyenne des 6 derniers mois complets, mois de 30 jours (mai à octobre : 87,0 M par mois, 2,9 M par jour)", () => {
    const reference = spendingReference(monthly, "2026-11-22");
    expect(reference?.months).toEqual(["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]);
    expect(reference?.perMonth).toBeCloseTo(87_000_000, -5);
    expect(reference?.perDay).toBeCloseTo(2_900_000, -3);
    expect(cushionAmount(reference, 15)).toBeCloseTo(43_500_000, -4);
    expect(cushionAmount(reference, 7)).toBeCloseTo(20_300_000, -4);
    expect(cushionAmount(reference, 30)).toBeCloseTo(87_000_000, -4);
  });
  it("le mois en cours n'est complet que si le relevé s'arrête le dernier jour du mois", () => {
    expect(spendingReference(monthly, "2026-11-30")?.months.at(-1)).toBe("2026-11");
    expect(spendingReference(monthly, "2026-11-29")?.months.at(-1)).toBe("2026-10");
  });
  it("sans mois complet : pas de réserve", () => {
    expect(spendingReference([{ m: "2026-11", credit: 0, debit: 1 }], "2026-11-10")).toBeNull();
    expect(cushionAmount(null, 15)).toBe(0);
  });
});

describe("niveaux de risque", () => {
  const base = { cushion: 43_500_000, lowest: 41_000_000, overdraftDate: null };
  it("vert : solde après paiements au-dessus de la réserve, point bas aussi, aucun découvert", () => {
    expect(riskLevel({ ...base, balanceAfter: 60_000_000, lowest: 60_000_000 })).toBe("vert");
  });
  it("orange : solde après paiements entre 0 et la réserve (cas du jour : 41,4 M < 43,5 M)", () => {
    expect(riskLevel({ ...base, balanceAfter: 41_378_405.18 })).toBe("orange");
  });
  it("orange : solde final au-dessus de la réserve mais point bas en dessous", () => {
    expect(riskLevel({ ...base, balanceAfter: 60_000_000, lowest: 30_000_000 })).toBe("orange");
  });
  it("rouge : solde négatif ou date de découvert", () => {
    expect(riskLevel({ ...base, balanceAfter: -1, lowest: -1 })).toBe("rouge");
    expect(riskLevel({ ...base, balanceAfter: 50_000_000, lowest: 5_000_000, overdraftDate: "2026-12-01" })).toBe("rouge");
  });
  it("le verdict est une phrase simple avec le niveau écrit", () => {
    const verdict = buildVerdict({ balanceAfter: 41_378_405.18, cushion: 43_500_000, lowest: 41_378_405.18, overdraftDate: null, perDay: 2_900_000, cushionDays: 15, lowestDate: "2026-11-22" });
    expect(verdict.level).toBe("orange");
    expect(verdict.title).toBe("Vigilance");
    expect(verdict.sentence).toContain("41,4 M DA");
    expect(verdict.sentence).toContain("14 jours");
    expect(verdict.sentence).toContain("réserve conseillée de 15 jours (43,5 M DA)");
    const rouge = buildVerdict({ balanceAfter: -2_000_000, cushion: 43_500_000, lowest: -2_000_000, overdraftDate: "2026-11-30", perDay: 2_900_000, cushionDays: 15, lowestDate: "2026-11-30" });
    expect(rouge.title).toBe("Risque de découvert");
    expect(rouge.sentence).toContain("30/11/2026");
  });
});

describe("chronologie jour par jour", () => {
  it("point bas, première date de découvert, mouvements antérieurs ramenés au départ", () => {
    const timeline = buildTimeline("2026-11-22", 100, [{ date: "2026-11-23", montant: 60 }, { date: "2026-11-25", montant: 70 }, { date: "2026-11-01", montant: 10 }], null);
    expect(timeline.points[0]).toMatchObject({ date: "2026-11-22", balance: 90, expected: null });
    expect(timeline.points.find((p) => p.date === "2026-11-23")?.balance).toBe(30);
    expect(timeline.overdraftDate).toBe("2026-11-25");
    expect(timeline.lowest).toEqual({ date: "2026-11-25", balance: -40 });
    expect(timeline.points.length).toBe(31);
  });
  it("les encaissements attendus forment une série séparée : le solde prudent ne bouge pas", () => {
    const timeline = buildTimeline("2026-11-22", 100, [{ date: "2026-11-23", montant: 150 }], [{ date: "2026-11-24", montant: 100 }]);
    expect(timeline.overdraftDate).toBe("2026-11-23");
    expect(timeline.points.find((p) => p.date === "2026-11-24")).toMatchObject({ balance: -50, expected: 50 });
  });
  it("horizon : au moins 30 jours, au plus 120", () => {
    expect(buildTimeline("2026-01-01", 10, [], null).points.length).toBe(31);
    expect(buildTimeline("2026-01-01", 10, [{ date: "2028-01-01", montant: 1 }], null).points.length).toBe(121);
  });
});

const balance: ResolvedBalance = { source: "releve", balance: 120_850_558.05, date: "2026-11-22", lastOperationDate: "2026-11-19", fileName: "report_92.xls", savedAt: "2026-11-22T09:05:00.000Z", savedBy: "Riad", sourceLabel: "relevé AGB importé" };
const emptyExpected = { rows: [], flows: [], total: 0 };
const cheque: IssuedCheque = { source: "rh", id: "hr1", numero: "7064745", montant: 22_752_053, date: "2026-11-19", beneficiaire: "Receveur des impôts Chéraga", libelle: "G50 octobre 2026" };

function input(overrides: Partial<ComputeInput> = {}): ComputeInput {
  return {
    today: "2026-11-22",
    balance,
    monthly,
    daily: [],
    adjustment: 0,
    cheques: chequesInCirculation([cheque], [], "2026-11-22", "2026-01-04"),
    invoices: [{ id: "f1", numero: "F1", tiers: "Prestataire A", categorie: "Prestataire assistance routière", libelle: "", dateFacture: "2026-11-02", remaining: 25_751_569.82 }, { id: "f2", numero: "F2", tiers: "Prestataire B", categorie: "Prestataire BDG", libelle: "", dateFacture: "2026-11-10", remaining: 30_968_530.05 }],
    preparedBatches: [{ ref: "VRMNT_ASSIS_4", montant: 11_188_764.32 }],
    requestsWithoutInvoice: [{ id: "d1", ref: "1292/2026AS", beneficiaire: "X", montant: 2_116_557.45 }],
    includeRequests: false,
    simulationLines: [],
    settings: { coussinJours: 15, encaissementsAttendus: false },
    collections: emptyExpected,
    ...overrides,
  };
}

describe("calcul de trésorerie", () => {
  it("retrouve les indicateurs du rapport : disponible 98 098 505,05, après paiements 41 378 405,18, couverture 1,73, Orange", () => {
    const result = computeTreasury(input());
    expect(result.chequesTotal).toBe(22_752_053);
    expect(result.available).toBe(98_098_505.05);
    expect(result.invoicesTotal).toBe(56_720_099.87);
    expect(result.balanceAfter).toBe(41_378_405.18);
    expect(result.coverageRatio).toBeCloseTo(1.73, 2);
    expect(result.cushion).toBeCloseTo(43_500_000, -4);
    expect(result.coverageDays).toBeCloseTo(14.3, 0);
    expect(result.verdict.level).toBe("orange");
  });

  it("double comptage : ni les virements préparés ni les demandes ne s'ajoutent au reste à payer", () => {
    const result = computeTreasury(input());
    expect(result.totalToPay).toBe(result.invoicesTotal);
    expect(result.preparedTotal).toBe(11_188_764.32);
    expect(result.requestsTotal).toBe(0);
    expect(result.requestsInfo).toEqual({ count: 1, total: 2_116_557.45 });
    expect(result.schedule.every((row) => row.source === "facture")).toBe(true);
  });

  it("les demandes sans facture liée ne sont comptées que si la case est cochée", () => {
    const result = computeTreasury(input({ includeRequests: true }));
    expect(result.requestsTotal).toBe(2_116_557.45);
    expect(result.totalToPay).toBe(58_836_657.32);
    expect(result.schedule.some((row) => row.source === "demande")).toBe(true);
  });

  it("sans la déduction du chèque, le solde après paiements serait surestimé de 22,75 M", () => {
    const without = computeTreasury(input({ cheques: chequesInCirculation([], [], "2026-11-22", "2026-01-04") }));
    expect(without.balanceAfter).toBe(64_130_458.18);
  });

  it("les lignes de simulation comptées changent le niveau ; une ligne « doublon, ne pas compter » est écartée ; rien n'est supprimé", () => {
    const line: SimLine = { id: "s1", type: "CNAS", libelle: "CNAS octobre", periode: "2026-10", montant: 60_000_000, date: "2026-11-30", mode: "VIREMENT", certitude: "ESTIME", decision: null };
    const counted = computeTreasury(input({ simulationLines: [line] }));
    expect(counted.simulationTotal).toBe(60_000_000);
    expect(counted.verdict.level).toBe("rouge");
    expect(counted.timeline.overdraftDate).toBe("2026-11-30");
    const ignored = computeTreasury(input({ simulationLines: [{ ...line, decision: "ignorer" }] }));
    expect(ignored.simulationTotal).toBe(0);
    expect(ignored.verdict.level).toBe("orange");
    const kept = computeTreasury(input({ simulationLines: [{ ...line, decision: "garder" }] }));
    expect(kept.simulationTotal).toBe(60_000_000);
  });

  it("les encaissements attendus n'entrent pas dans le solde après paiements ni dans le niveau", () => {
    const collections = { rows: [], flows: [{ date: "2026-11-25", montant: 80_000_000 }], total: 80_000_000 };
    const result = computeTreasury(input({ settings: { coussinJours: 15, encaissementsAttendus: true }, collections }));
    expect(result.balanceAfter).toBe(41_378_405.18);
    expect(result.balanceAfterExpected).toBe(121_378_405.18);
    expect(result.verdict.level).toBe("orange");
    expect(result.timeline.points.at(-1)?.expected).toBe(121_378_405.18);
  });

  it("le coussin de 7 jours rend la situation du jour verte", () => {
    expect(computeTreasury(input({ settings: { coussinJours: 7, encaissementsAttendus: false } })).verdict.level).toBe("vert");
  });

  it("l'échéancier cumule le solde après chaque paiement", () => {
    const result = computeTreasury(input());
    expect(result.schedule.at(-1)?.balanceAfter).toBe(result.balanceAfter);
  });
});

describe("classement des factures et ordre de priorité", () => {
  it("catégories : assistance routière, BDG et variantes, autres", () => {
    expect(invoiceNature("Prestataire assistance routière")).toBe("assistance");
    expect(invoiceNature("Prestataire assistance")).toBe("assistance");
    expect(invoiceNature("Prestataire BDG")).toBe("bdg");
    expect(invoiceNature("prestataire bris de glace")).toBe("bdg");
    expect(invoiceNature("Fournisseur")).toBe("autre");
    expect(invoiceNature("")).toBe("autre");
  });
  it("ordre : fiscal et social, salaires, assistance (la plus ancienne d'abord), BDG, autres", () => {
    const item = (id: string, nature: PayableItem["nature"], ageDays: number | null, montant = 100): PayableItem => ({ id, date: "2026-11-22", beneficiaire: id, libelle: id, nature, montant, source: "facture", certain: true, ageDays });
    const ordered = priorityOrder([item("autre", "autre", 50), item("bdg", "bdg", 40), item("assist-jeune", "assistance", 5), item("assist-vieux", "assistance", 30), item("salaire", "salaire", null), item("cnas", "social", null), item("g50", "fiscal", null, 500)]);
    expect(ordered.map((entry) => entry.id)).toEqual(["g50", "cnas", "salaire", "assist-vieux", "assist-jeune", "bdg", "autre"]);
    expect(priorityGroups(ordered).map((group) => group.rank)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("chèques émis non débités", () => {
  const debits: BankDebit[] = [
    { date: "2026-11-04", libelle: "PAIEMENT CHEQUE N°  TL-7064740", numero: "TL-7064740", montant: 13_916_005 },
    { date: "2026-11-19", libelle: "Commission Virement", numero: "", montant: 1_500_000 },
  ];
  it("le G50 n° 7064745 n'a aucun débit : en circulation ; le chèque 7064740 débité le 04/11 est déjà dans le solde", () => {
    const report = chequesInCirculation([cheque, { ...cheque, id: "hr0", numero: "TL-7064740", montant: 13_916_005, date: "2026-11-04" }], debits, "2026-11-22", "2026-01-04");
    expect(report.circulation.map((c) => c.numero)).toEqual(["7064745"]);
    expect(report.total).toBe(22_752_053);
    expect(report.checks.find((c) => c.cheque.id === "hr0")).toMatchObject({ status: "debite", matchedBy: "numero", debitDate: "2026-11-04" });
  });
  it("à défaut de numéro dans le libellé : débit de même montant à ± 10 jours", () => {
    const report = chequesInCirculation([{ ...cheque, montant: 1_500_000, date: "2026-11-25" }], debits, "2026-11-26", "2026-01-04");
    expect(report.checks[0]).toMatchObject({ status: "debite", matchedBy: "montant" });
    const far = chequesInCirculation([{ ...cheque, montant: 1_500_000, date: "2026-12-05" }], debits, "2026-12-06", "2026-01-04");
    expect(far.checks[0]?.status).toBe("circulation");
  });
  it("trop ancien, sans date ou antérieur au relevé : à vérifier, non déduit", () => {
    const report = chequesInCirculation([{ ...cheque, id: "a", date: "2026-05-01" }, { ...cheque, id: "b", numero: "9990001", date: null }, { ...cheque, id: "c", numero: "9990002", date: "2025-12-01" }], [], "2026-11-22", "2026-01-04");
    expect(report.total).toBe(0);
    expect(report.toVerify.length).toBe(3);
  });
  it("une écriture RH et une facture portant le même numéro ne se comptent pas deux fois", () => {
    const report = chequesInCirculation([cheque, { ...cheque, source: "facture", id: "inv1" }], [], "2026-11-22", "2026-01-04");
    expect(report.circulation.length).toBe(1);
    expect(report.total).toBe(22_752_053);
  });
  it("les factures d'un même chèque s'additionnent", () => {
    const report = chequesInCirculation([{ ...cheque, source: "facture", id: "i1", numero: "TL-5550001", montant: 100 }, { ...cheque, source: "facture", id: "i2", numero: "TL-5550001", montant: 50 }], [], "2026-11-22", "2026-01-04");
    expect(report.total).toBe(150);
  });
});

describe("encaissements attendus", () => {
  const settled: SettledInput[] = Array.from({ length: 10 }, (_, index) => ({ categorie: "CAAT", libelle: "", tiers: "ALLO Assistance", dateFacture: "2026-03-01", dateOperation: `2026-04-${String(1 + index * 2).padStart(2, "0")}` }));
  it("regroupe par catégorie puis libellé (le tiers est souvent « ALLO Assistance »)", () => {
    expect(companyOf({ categorie: "BDG CAAT", libelle: "", tiers: "ALLO Assistance" })).toBe("CAAT");
    expect(companyOf({ categorie: "Honoraire GAM", libelle: "", tiers: "" })).toBe("GAM");
    expect(companyOf({ categorie: "Trust BDG", libelle: "", tiers: "" })).toBe("TRUST");
    expect(companyOf({ categorie: "", libelle: "Facture MLA", tiers: "" })).toBe("MLA");
    expect(companyOf({ categorie: "Autre", libelle: "", tiers: "Dupont" })).toBe("AUTRES");
  });
  it("médiane et 80e percentile", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.8)).toBe(8);
  });
  it("option désactivée : rien n'est compté", () => {
    const stats = delayStats(settled);
    const pending: PendingReceivable[] = [{ id: "r1", numero: "R1", categorie: "CAAT", libelle: "", tiers: "", dateFacture: "2026-11-15", remaining: 1_000_000 }];
    const off = expectedCollections(pending, stats, "2026-11-22", false);
    expect(off.total).toBe(0);
    expect(off.flows).toEqual([]);
    expect(off.rows[0]?.total).toBe(1_000_000);
  });
  it("option activée : date de facture + délai médian, décote de 20 %, rien pour une facture en retard ou hors 80e percentile", () => {
    const stats = delayStats(settled);
    const caat = stats.find((s) => s.company === "CAAT");
    expect(caat?.medianDays).toBe(40);
    const pending: PendingReceivable[] = [
      { id: "ok", numero: "A", categorie: "CAAT", libelle: "", tiers: "", dateFacture: "2026-11-15", remaining: 1_000_000 },
      { id: "retard", numero: "B", categorie: "CAAT", libelle: "", tiers: "", dateFacture: "2026-08-01", remaining: 5_000_000 },
      { id: "sansdate", numero: "C", categorie: "CAAT", libelle: "", tiers: "", dateFacture: null, remaining: 5_000_000 },
      { id: "gam", numero: "D", categorie: "GAM", libelle: "", tiers: "", dateFacture: "2026-11-15", remaining: 9_000_000 },
    ];
    const on = expectedCollections(pending, stats, "2026-11-22", true);
    expect(on.flows).toEqual([{ date: "2026-12-25", montant: 800_000 }]);
    expect(on.total).toBe(800_000);
    expect(on.rows.find((r) => r.company === "GAM")?.counted).toBe(0);
  });
});
