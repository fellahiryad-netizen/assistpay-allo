import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readWorkbook } from "@/lib/spreadsheet";
import { applyRefusedImport, applyValidImport, EMPTY_SOLDE, freshness, resolveBalance, workingDaysBetween } from "@/features/treasury/lib/balance-state";
import { parseBankAmount, parseBankDate, parseStatementBalance } from "@/features/treasury/lib/statement-balance";
import { parseSolde } from "@/features/treasury/lib/store-parse";
import { fmt, OPS, statement } from "./helpers/agb-statement";
import type { SoldeState } from "@/features/treasury/types";

const SAMPLE = "/mnt/user-data/attachments/c375eb72-b227-55d5-a228-05a47cbff5a6/aa04b5b3-report_92.xls";

describe("montants et dates AGB", () => {
  it("lit les montants à espace insécable, espace fine, virgule décimale et point décimal brut", () => {
    expect(parseBankAmount("-2 000,00")).toBe(-2000);
    expect(parseBankAmount("120 850 558,05")).toBe(120850558.05);
    expect(parseBankAmount("120 850 558,05")).toBe(120850558.05);
    expect(parseBankAmount("71916633.9700")).toBe(71916633.97);
    expect(parseBankAmount("-819021353.08")).toBe(-819021353.08);
    expect(parseBankAmount("0,00")).toBe(0);
    expect(Number.isNaN(parseBankAmount(""))).toBe(true);
    expect(Number.isNaN(parseBankAmount("somme débit:"))).toBe(true);
    expect(Number.isNaN(parseBankAmount("2026/11/22"))).toBe(true);
  });
  it("lit les dates JJ/MM/AAAA et AAAA/MM/JJ", () => {
    expect(parseBankDate("19/11/2026")).toBe("2026-11-19");
    expect(parseBankDate("2026/11/22")).toBe("2026-11-22");
    expect(parseBankDate("31/02/2026")).toBe("");
    expect(parseBankDate("120850558.0500")).toBe("");
  });
});

describe("solde d'un relevé AGB synthétique", () => {
  it("lit le solde, les totaux, les mois et la dernière opération", () => {
    const result = parseStatementBalance(statement(OPS));
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    const { balance } = result;
    expect(balance.balanceDate).toBe("2026-11-22");
    expect(balance.sens).toBe("CT");
    expect(balance.opening).toBe(1_000_000);
    expect(balance.rowCount).toBe(6);
    expect(balance.lastOperationDate).toBe("2026-11-19");
    expect(balance.sumCredits).toBe(25_255_516);
    expect(balance.sumDebits).toBe(-15_411_348.36);
    expect(balance.balance).toBe(10_844_167.64);
    expect(balance.checks).toEqual({ formula: true, lastLine: true, chain: true });
    expect(balance.monthly.find((month) => month.m === "2026-11")?.debit).toBe(15_411_348.36);
    // Solde de fin de journée : celui de la première ligne (la plus récente) de la date.
    expect(balance.daily.find((day) => day.d === "2026-11-19")?.b).toBe(10_844_167.64);
    expect(balance.daily.find((day) => day.d === "2026-11-18")?.b).toBe(12_339_511);
  });

  it("accepte l'espace fine comme séparateur de milliers", () => {
    expect(parseStatementBalance(statement(OPS, { sep: " " })).kind).toBe("ok");
  });

  it("contrôle 1 : départ + crédits − débits différent du « Solde FIN AU » → relevé incohérent", () => {
    const rows = statement(OPS, {
      tamper: (all) => {
        const footer = all.find((row) => row[0] === "Solde FIN AU");
        if (footer) footer[4] = "10844168.6400";
      },
    });
    const result = parseStatementBalance(rows);
    expect(result.kind).toBe("refused");
    if (result.kind === "refused") {
      expect(result.reason).toBe("incoherent");
      expect(result.checks?.formula).toBe(false);
      expect(result.message).toContain("incohérent");
    }
  });

  it("contrôle 2 : le solde de la première ligne ne correspond pas → incohérent", () => {
    const rows = statement(OPS, {
      tamper: (all) => {
        const first = all.find((row) => row[6] === "Commission Virement RTGS AGBONLINE");
        if (first) first[15] = fmt(10_844_000);
      },
    });
    const result = parseStatementBalance(rows);
    expect(result.kind).toBe("refused");
    if (result.kind === "refused") expect(result.checks?.lastLine).toBe(false);
  });

  it("contrôle 3 : une rupture de la chaîne ligne à ligne est détectée et la ligne est citée", () => {
    const rows = statement(OPS, {
      tamper: (all) => {
        const middle = all.find((row) => row[6] === "PAIEMENT CHEQUE N° TL-7064740");
        if (middle) middle[15] = fmt(1);
      },
    });
    const result = parseStatementBalance(rows);
    expect(result.kind).toBe("refused");
    if (result.kind === "refused") {
      expect(result.checks?.chain).toBe(false);
      expect(result.message).toContain("chaîne");
    }
  });

  it("refuse un autre numéro de compte", () => {
    const result = parseStatementBalance(statement(OPS, { account: "2737851999" }));
    expect(result).toMatchObject({ kind: "refused", reason: "compte" });
  });

  it("ne reconnaît pas la structure d'un fichier quelconque (rien n'est bloqué)", () => {
    const result = parseStatementBalance([["Date", "Libellé", "Débit", "Crédit"], ["01/01/2026", "x", "10", ""]]);
    expect(result).toMatchObject({ kind: "refused", reason: "structure" });
  });

  it("sens DB : solde négatif (découvert)", () => {
    const rows = statement([{ date: "2026-11-19", label: "Retrait", amount: -1_500_000 }], { opening: 1_000_000, sens: "DB" });
    const footer = rows.find((row) => row[0] === "Solde FIN AU");
    if (footer) footer[4] = "500000.0000";
    const result = parseStatementBalance(rows);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.balance.balance).toBe(-500_000);
      expect(result.balance.sens).toBe("DB");
    }
  });

  it("fichier du plus ancien au plus récent : même solde", () => {
    const rows = statement(OPS);
    const head = rows.slice(0, 7);
    const ops = rows.slice(7, 7 + OPS.length).reverse();
    const result = parseStatementBalance([...head, ...ops, ...rows.slice(7 + OPS.length)]);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") expect(result.balance.balance).toBe(10_844_167.64);
  });
});

describe.skipIf(!existsSync(SAMPLE))("fichier réel report_92.xls", () => {
  it("donne le solde attendu au centime, les 3 contrôles et les totaux du rapport", () => {
    const rows = readWorkbook(new Uint8Array(readFileSync(SAMPLE)))[0]?.rows ?? [];
    const result = parseStatementBalance(rows);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    const { balance } = result;
    expect(balance.balance).toBe(120_850_558.05);
    expect(balance.balanceDate).toBe("2026-11-22");
    expect(balance.lastOperationDate).toBe("2026-11-19");
    expect(balance.opening).toBe(71_916_633.97);
    expect(balance.sumCredits).toBe(867_955_277.16);
    expect(balance.sumDebits).toBe(-819_021_353.08);
    expect(balance.rowCount).toBe(1298);
    expect(balance.checks).toEqual({ formula: true, lastLine: true, chain: true });
    const lowest = balance.daily.reduce((min, day) => (day.b < min.b ? day : min));
    expect(lowest).toEqual({ d: "2026-06-17", b: 38_242_115.22 });
    const may = balance.monthly.find((month) => month.m === "2026-05");
    expect(Math.round((may?.debit ?? 0) / 10_000) / 100).toBe(50.58);
  });
});

describe("état du solde enregistré", () => {
  const rows = statement(OPS);
  const parsed = parseStatementBalance(rows);
  if (parsed.kind !== "ok") throw new Error("relevé de test illisible");
  const info = { fileName: "report.xls", importedAt: "2026-11-22T09:05:00.000Z", importedBy: "Riad" };

  it("enregistre un premier relevé valide", () => {
    const decision = applyValidImport(EMPTY_SOLDE, parsed.balance, info);
    expect(decision.action).toBe("stored");
    expect(resolveBalance(decision.state)?.balance).toBe(10_844_167.64);
  });

  it("n'écrase jamais un solde plus récent par un relevé plus ancien", () => {
    const recent = applyValidImport(EMPTY_SOLDE, parsed.balance, info).state;
    const older = { ...parsed.balance, balanceDate: "2026-11-10", balance: 1 };
    const decision = applyValidImport(recent, older, { ...info, fileName: "ancien.xls" });
    expect(decision.action).toBe("ignored");
    expect(decision.state.current?.balance).toBe(10_844_167.64);
    expect(decision.state.rejection?.reason).toBe("ancien");
  });

  it("un refus garde le solde précédent et trace le motif", () => {
    const recent = applyValidImport(EMPTY_SOLDE, parsed.balance, info).state;
    const state = applyRefusedImport(recent, { reason: "incoherent", message: "x", fileName: "mauvais.xls", at: "2026-11-23T08:00:00.000Z" });
    expect(state.current?.balance).toBe(10_844_167.64);
    expect(state.rejection?.fileName).toBe("mauvais.xls");
  });

  it("le solde saisi à la main ne l'emporte que s'il est plus récent, et disparaît à l'import d'un relevé valide au moins aussi récent", () => {
    const manualOld: SoldeState = { current: null, manual: { balance: 5, date: "2026-11-20", source: "relevé du 20/11", savedAt: "", savedBy: "Admin" }, rejection: null };
    expect(resolveBalance(manualOld)).toMatchObject({ source: "manuel", balance: 5 });
    const withImport = applyValidImport(manualOld, parsed.balance, info).state;
    expect(withImport.manual).toBeNull();
    expect(resolveBalance(withImport)?.source).toBe("releve");
    const manualNewer: SoldeState = { ...withImport, manual: { balance: 9, date: "2026-11-25", source: "x", savedAt: "", savedBy: "" } };
    expect(resolveBalance(manualNewer)?.source).toBe("manuel");
  });

  it("lecture tolérante : un solde stocké dont un contrôle est faux est écarté", () => {
    const stored = JSON.parse(JSON.stringify(applyValidImport(EMPTY_SOLDE, parsed.balance, info).state)) as SoldeState;
    expect(parseSolde(stored).current?.balance).toBe(10_844_167.64);
    stored.current = stored.current ? { ...stored.current, checks: { formula: true, lastLine: true, chain: false } } : null;
    expect(parseSolde(stored).current).toBeNull();
    expect(parseSolde("n'importe quoi")).toEqual(EMPTY_SOLDE);
  });
});

describe("fraîcheur (week-end algérien : vendredi et samedi)", () => {
  it("compte les jours ouvrés du dimanche au jeudi", () => {
    // 22/11/2026 est un dimanche ; 19/11 un jeudi.
    expect(workingDaysBetween("2026-11-19", "2026-11-22")).toBe(1);
    expect(workingDaysBetween("2026-11-22", "2026-11-22")).toBe(0);
    expect(workingDaysBetween("2026-11-22", "2026-11-29")).toBe(5);
  });
  it("orange au-delà de 2 jours ouvrés, rouge au-delà de 5", () => {
    expect(freshness("2026-11-22", "2026-11-24").level).toBe("ok");
    expect(freshness("2026-11-22", "2026-11-25").level).toBe("orange");
    expect(freshness("2026-11-22", "2026-11-29").level).toBe("orange");
    expect(freshness("2026-11-22", "2026-11-30").level).toBe("rouge");
  });
});
