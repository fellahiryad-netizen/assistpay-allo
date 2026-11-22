import type { SheetCell } from "@/lib/spreadsheet";
import { parseLooseAmount, round2 } from "@/utils/amounts";
import { dayGap } from "@/utils/dates";
import { upperPlain } from "@/utils/text";
import {
  AGB_ACCOUNT,
  BALANCE_TOLERANCE,
  type BalanceChecks,
  type DailyBalance,
  type MonthlyFlow,
  type StatementBalanceResult,
} from "@/features/treasury/types";

/** Texte d'une cellule (dates en `AAAA-MM-JJ`). */
function text(cell: SheetCell | undefined): string {
  if (cell === null || cell === undefined) return "";
  if (cell instanceof Date) return Number.isNaN(cell.getTime()) ? "" : new Date(cell.getTime() + 12 * 3600 * 1000).toISOString().slice(0, 10);
  return String(cell).trim();
}

/**
 * Date d'un relevé AGB : « JJ/MM/AAAA » ou « AAAA/MM/JJ » (« Solde FIN AU 2026/11/22 »), tirets acceptés, objet Date accepté.
 * Renvoie `AAAA-MM-JJ` ou une chaîne vide.
 */
export function parseBankDate(value: SheetCell | undefined): string {
  const raw = text(value);
  let match = raw.match(/^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})/);
  let year = "";
  let month = "";
  let day = "";
  if (match) {
    [, year = "", month = "", day = ""] = match;
  } else {
    match = raw.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
    if (!match) return "";
    [, day = "", month = "", year = ""] = match;
  }
  const iso = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso ? "" : iso;
}

/**
 * Montant d'un relevé AGB : « -2 000,00 » (espace insécable ou fine, virgule décimale) ou « 71916633.9700 » (point décimal brut).
 * Renvoie NaN pour une cellule vide ou non numérique.
 */
export function parseBankAmount(value: SheetCell | undefined): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : Number.NaN;
  if (value === null || value === undefined) return Number.NaN;
  const cleaned = String(value).replace(/[\s\u00a0\u202f\u2009\u200b]/g, "");
  if (!/^[-+(]?[\d.,]+\)?$/.test(cleaned)) return Number.NaN;
  return parseLooseAmount(cleaned);
}

interface Operation {
  date: string;
  credit: number;
  /** Débit en valeur positive. */
  debit: number;
  balance: number;
  line: number;
}

interface Columns {
  header: number;
  date: number;
  debit: number;
  credit: number;
  balance: number;
  label: number;
}

function findColumns(rows: SheetCell[][]): Columns | null {
  for (let index = 0; index < Math.min(rows.length, 60); index += 1) {
    const row = rows[index] ?? [];
    const names = row.map((cell) => upperPlain(text(cell)));
    const balance = names.findIndex((name) => name === "SOLDE");
    const debit = names.findIndex((name) => name === "DEBIT");
    const credit = names.findIndex((name) => name === "CREDIT");
    const date = names.findIndex((name) => name.startsWith("DATE OPERATION") || name === "DATE");
    if (balance >= 0 && debit >= 0 && credit >= 0 && date >= 0) {
      const label = names.findIndex((name) => name.startsWith("LIBELLE"));
      return { header: index, date, debit, credit, balance, label };
    }
  }
  return null;
}

/** Premier nombre lu à droite de la colonne `from` (même ligne). */
function amountRightOf(row: SheetCell[], from: number): number {
  for (let col = from + 1; col < row.length; col += 1) {
    const value = parseBankAmount(row[col]);
    if (Number.isFinite(value)) return value;
  }
  return Number.NaN;
}

interface Footer {
  balanceDate: string;
  balance: number;
  sens: "CT" | "DB" | "";
  sumCredits: number;
  sumDebits: number;
}

function readFooter(rows: SheetCell[][], from: number): Footer | null {
  let balanceDate = "";
  let balance = Number.NaN;
  let sens: Footer["sens"] = "";
  let sumCredits = Number.NaN;
  let sumDebits = Number.NaN;
  for (let index = from; index < rows.length; index += 1) {
    const row = rows[index] ?? [];
    for (let col = 0; col < row.length; col += 1) {
      const label = upperPlain(text(row[col])).replace(/\s+/g, " ");
      if (label.startsWith("SOLDE FIN AU")) {
        for (let next = col + 1; next < row.length; next += 1) {
          const cell = row[next];
          const upper = upperPlain(text(cell));
          if (!balanceDate && parseBankDate(cell)) balanceDate = parseBankDate(cell);
          else if (Number.isNaN(balance) && Number.isFinite(parseBankAmount(cell)) && !parseBankDate(cell)) balance = parseBankAmount(cell);
          else if (upper === "CT" || upper === "DB") sens = upper;
        }
      } else if (/^SOMME CREDIT/.test(label)) sumCredits = amountRightOf(row, col);
      else if (/^SOMME DEBIT/.test(label)) sumDebits = amountRightOf(row, col);
    }
  }
  if (!balanceDate || !Number.isFinite(balance)) return null;
  return { balanceDate, balance, sens, sumCredits, sumDebits };
}

/** Chaîne ligne à ligne, lignes classées de la plus récente à la plus ancienne ; renvoie l'indice (0 = première) de la première rupture ou -1. */
function firstChainBreak(newestFirst: readonly Operation[], opening: number): number {
  for (let index = 0; index < newestFirst.length; index += 1) {
    const current = newestFirst[index];
    if (!current) continue;
    const previous = index + 1 < newestFirst.length ? newestFirst[index + 1]?.balance : opening;
    if (previous === undefined) continue;
    if (Math.abs(round2(previous + current.credit - current.debit) - current.balance) > BALANCE_TOLERANCE) return index;
  }
  return -1;
}

const refuse = (reason: "structure" | "compte" | "incoherent", message: string, checks: BalanceChecks | null = null): StatementBalanceResult => ({ kind: "refused", reason, message, checks });

/**
 * Lit le solde d'un relevé AGB (lignes d'une feuille alignées sur A1) et le contrôle.
 *
 * Le solde de référence est « Solde FIN AU <date> » (sens CT = créditeur, DB = débiteur). Trois contrôles doivent passer :
 * (1) solde de départ + crédits − débits = Solde FIN AU ; (2) le solde de la dernière opération = Solde FIN AU ;
 * (3) chaîne ligne à ligne (solde = solde précédent + crédit − débit). Le sens du fichier (plus récent en tête ou en queue) est détecté.
 * Refus : structure non reconnue (fichier d'une autre banque ou d'un autre format), numéro de compte différent, relevé incohérent.
 * Ne lit ni n'écrit rien en base ; pure.
 */
export function parseStatementBalance(rows: SheetCell[][]): StatementBalanceResult {
  let account = "";
  for (const row of rows.slice(0, 40)) {
    for (const cell of row) {
      const match = text(cell).match(/N(?:um[ée]ro|°|o)?\s*(?:de\s*)?compte\s*:?\s*([0-9 ]{6,})/i);
      if (match?.[1]) {
        account = match[1].replace(/\s/g, "");
        break;
      }
    }
    if (account) break;
  }
  const columns = findColumns(rows);
  const footer = columns ? readFooter(rows, columns.header + 1) : null;
  if (!account || !columns || !footer) return refuse("structure", "Le fichier n'a pas la structure d'un relevé AGB (numéro de compte, colonne Solde ou « Solde FIN AU » introuvables) : le solde n'est pas mis à jour.");
  if (account !== AGB_ACCOUNT) return refuse("compte", `Le relevé concerne le compte ${account}, pas le compte AGB ${AGB_ACCOUNT} : le solde n'est pas mis à jour.`);

  let opening = Number.NaN;
  let openingDate = "";
  const operations: Operation[] = [];
  rows.forEach((row, index) => {
    if (index <= columns.header) return;
    const date = parseBankDate(row[columns.date]);
    const balance = parseBankAmount(row[columns.balance]);
    if (!date || !Number.isFinite(balance)) return;
    const label = upperPlain(columns.label >= 0 ? text(row[columns.label]) : "");
    if (/^SOLDE\s+(DE\s+)?DEPART/.test(label)) {
      opening = balance;
      openingDate = date;
      return;
    }
    const credit = parseBankAmount(row[columns.credit]);
    const debit = parseBankAmount(row[columns.debit]);
    operations.push({ date, credit: Number.isFinite(credit) ? Math.abs(credit) : 0, debit: Number.isFinite(debit) ? Math.abs(debit) : 0, balance, line: index + 1 });
  });
  if (!Number.isFinite(opening)) return refuse("structure", "La ligne « solde depart » est introuvable : le solde n'est pas mis à jour.");

  const signed = footer.sens === "DB" ? -Math.abs(footer.balance) : footer.balance;
  const sumCredits = round2(operations.reduce((sum, item) => sum + item.credit, 0));
  const sumDebitsPositive = round2(operations.reduce((sum, item) => sum + item.debit, 0));
  const formula = Math.abs(round2(opening + sumCredits - sumDebitsPositive) - signed) <= BALANCE_TOLERANCE;
  const totalsMatch =
    (!Number.isFinite(footer.sumCredits) || Math.abs(footer.sumCredits - sumCredits) <= BALANCE_TOLERANCE) &&
    (!Number.isFinite(footer.sumDebits) || Math.abs(Math.abs(footer.sumDebits) - sumDebitsPositive) <= BALANCE_TOLERANCE);

  // Sens du fichier : le plus récent en tête (cas AGB) ou en queue ; on garde celui dont la chaîne tient.
  const fileOrder = operations;
  const reversed = [...operations].reverse();
  const breakFile = firstChainBreak(fileOrder, opening);
  const breakReversed = breakFile === -1 ? 0 : firstChainBreak(reversed, opening);
  const chain = breakFile === -1 || breakReversed === -1;
  const newestFirst = breakFile === -1 ? fileOrder : breakReversed === -1 ? reversed : fileOrder;
  const newest = newestFirst[0];
  const lastLine = newest ? Math.abs(newest.balance - signed) <= BALANCE_TOLERANCE : Math.abs(opening - signed) <= BALANCE_TOLERANCE;
  const checks: BalanceChecks = { formula, lastLine, chain };

  if (!formula || !lastLine || !chain || !totalsMatch) {
    const problems: string[] = [];
    if (!formula) problems.push("départ + crédits − débits ne donne pas le « Solde FIN AU »");
    if (!lastLine) problems.push("le solde de la dernière opération ne correspond pas au « Solde FIN AU »");
    if (!chain) problems.push(`la chaîne des soldes se rompt à la ligne ${newestFirst[breakFile === -1 ? 0 : breakFile]?.line ?? "?"} du fichier`);
    if (!totalsMatch) problems.push("les totaux « somme crédit » / « somme débit » du fichier ne correspondent pas aux lignes");
    return refuse("incoherent", `Relevé incohérent : ${problems.join(" ; ")}. Le solde n'est pas mis à jour.`, checks);
  }

  // Soldes de fin de journée : solde de la première ligne (la plus récente) de chaque date.
  const seen = new Set<string>();
  const daily: DailyBalance[] = [];
  for (const item of newestFirst) {
    if (seen.has(item.date)) continue;
    seen.add(item.date);
    daily.push({ d: item.date, b: round2(item.balance) });
  }
  if (openingDate && !seen.has(openingDate)) daily.push({ d: openingDate, b: round2(opening) });
  daily.sort((a, b) => a.d.localeCompare(b.d));

  const flows = new Map<string, MonthlyFlow>();
  for (const item of operations) {
    const month = item.date.slice(0, 7);
    const flow = flows.get(month) ?? { m: month, credit: 0, debit: 0 };
    flow.credit = round2(flow.credit + item.credit);
    flow.debit = round2(flow.debit + item.debit);
    flows.set(month, flow);
  }
  const monthly = [...flows.values()].sort((a, b) => a.m.localeCompare(b.m));

  const gaps: string[] = [];
  const dates = [...seen].sort();
  for (let index = 1; index < dates.length; index += 1) {
    const before = dates[index - 1];
    const after = dates[index];
    if (before && after && dayGap(before, after) > 7) gaps.push(`${before} → ${after}`);
  }

  const editedRow = rows.slice(0, 12).map((row) => text(row[0]).match(/^Date\s*:\s*(.+)$/i)?.[1]).find((value) => value !== undefined);
  return {
    kind: "ok",
    balance: {
      accountNumber: account,
      balanceDate: footer.balanceDate,
      balance: round2(signed),
      sens: footer.sens === "DB" || signed < 0 ? "DB" : "CT",
      editedOn: parseBankDate(editedRow) || null,
      opening: round2(opening),
      openingDate: openingDate || null,
      sumCredits,
      sumDebits: round2(-sumDebitsPositive),
      rowCount: operations.length,
      lastOperationDate: operations.reduce<string | null>((max, item) => (max === null || item.date > max ? item.date : max), null),
      checks,
      daily,
      monthly,
      gaps,
    },
  };
}
