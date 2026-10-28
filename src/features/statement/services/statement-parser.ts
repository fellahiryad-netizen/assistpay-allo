import type { SheetCell } from "@/lib/spreadsheet";
import type { BankPaymentType, ColumnMapping, ParsedLine } from "@/features/statement/types";
import { parseLooseAmount, round2 } from "@/utils/amounts";
import { parseLooseDate } from "@/utils/dates";
import { upperPlain } from "@/utils/text";

const COLUMN_NAMES: Readonly<Record<keyof Omit<ColumnMapping, "montant"> | "montant", readonly string[]>> = {
  ref: ["N° PIECE", "N PIECE", "PIECE", "NUMERO", "N° OPERATION", "REF"],
  date: ["DATE OPERATION", "DATE OPER", "DATE", "DATE VALEUR"],
  libelle: ["LIBELLE", "DESIGNATION", "OPERATION", "DESCRIPTION", "NATURE", "MOTIF", "REFERENCE"],
  debit: ["DEBIT", "SORTIE", "RETRAIT"],
  credit: ["CREDIT", "ENTREE", "VERSEMENT"],
  montant: ["MONTANT", "SOMME"],
};

/** Frais bancaires écartés de l'analyse (commissions, TVA sur commissions, Swift, tenue de compte, agios). */
export const BANK_FEE_PATTERN = /COMMISSION|COMMIS\b|^TVA\b|\bTVA\b.*(COMMIS|FRAIS)|FRAIS (SWIFT|DE TENUE|TENUE)|TENUE DE COMPTE|PACK WEB|AGIOS|FRAIS BANCAIRES/;

/** Lignes de paie (salaires, CNAS, impôts sur salaires, missions). */
export const PAYROLL_PATTERN = /SALAIRE|CNAS|CASNOS|\bG ?50\b|\bIRG\b|\bIBS\b|FRAIS DE MISSION|\bMISSION\b|REMBOURSEMENT EMPLOY/;

function cellText(cell: SheetCell | undefined): string {
  if (cell === null || cell === undefined) return "";
  if (cell instanceof Date) return cell.toISOString().slice(0, 10);
  return String(cell).trim();
}

/** Repère la ligne d'en-tête : celle (parmi les 40 premières) qui contient le plus de noms de colonnes connus. */
export function detectHeaderRow(rows: SheetCell[][]): number {
  const known = Object.values(COLUMN_NAMES).flat();
  let best = -1;
  let header = 0;
  rows.slice(0, 40).forEach((row, index) => {
    const score = row.filter((cell) => {
      const text = upperPlain(cellText(cell));
      return text !== "" && known.some((name) => text.includes(upperPlain(name)));
    }).length;
    if (score > best) {
      best = score;
      header = index;
    }
  });
  return header;
}

/** Devine la correspondance des colonnes à partir des intitulés. */
export function guessMapping(headers: string[]): ColumnMapping {
  const normalized = headers.map((header) => upperPlain(header));
  const find = (key: keyof ColumnMapping): number => {
    const names = COLUMN_NAMES[key].map(upperPlain);
    for (const name of names) {
      const index = normalized.findIndex((header) => header === name);
      if (index >= 0) return index;
    }
    for (const name of names) {
      const index = normalized.findIndex((header) => header.includes(name));
      if (index >= 0) return index;
    }
    return -1;
  };
  const mapping: ColumnMapping = { date: find("date"), libelle: find("libelle"), ref: find("ref"), credit: find("credit"), debit: find("debit"), montant: -1 };
  if (mapping.ref === mapping.libelle) mapping.ref = -1;
  if (mapping.debit < 0 && mapping.credit < 0) mapping.montant = find("montant");
  return mapping;
}

/** Mode de paiement et numéro tirés du libellé bancaire (règle reprise de l'ancienne version). */
export function paymentModeOf(libelle: string, ref: string): { type: BankPaymentType; numero: string } {
  const text = upperPlain(libelle);
  let type: BankPaymentType = "";
  let numero = "";
  if (/\b(CHQ|CHEQUE|CHEQ)\b/.test(text)) {
    type = "CHEQUE";
    const match = text.match(/(?:CHQ|CHEQUE|CHEQ)[^A-Z0-9]*(?:N[^A-Z0-9]*)?([A-Z]{1,4}-?\d{3,}|\d{4,})/);
    if (match?.[1]) numero = match[1];
  } else if (/VERSEMENT|VRSMT/.test(text)) {
    type = "VRSMT";
  } else if (/VIR|TELECOMPENS|TRANSFERT/.test(text)) {
    type = "VIRMT";
  }
  if (ref.trim()) numero = ref.trim();
  return { type, numero };
}

/**
 * Identifiant stable d'une ligne de relevé — calcul identique à l'ancienne version,
 * pour reconnaître une ligne déjà importée, même depuis l'ancien AssistPay.
 */
export function statementLineKey(line: { date: string; sens: "CREDIT" | "DEBIT"; montant: number; libelle: string }): string {
  const sens = line.sens === "CREDIT" ? "Crédit" : "Débit";
  const label = upperPlain(line.libelle).replace(/[^A-Z0-9]/g, "").slice(0, 60);
  const source = `${line.date}|${sens}|${line.montant.toFixed(2)}|${label}`;
  let hash = 0;
  for (let index = 0; index < source.length; index += 1) {
    hash = ((hash << 5) - hash + source.charCodeAt(index)) | 0;
  }
  return `l${line.date.replace(/-/g, "")}_${Math.round(line.montant * 100)}_${(hash >>> 0).toString(36)}`;
}

/** Lit les opérations du fichier selon la correspondance de colonnes choisie. */
export function readStatementLines(rows: SheetCell[][], headerRow: number, mapping: ColumnMapping): ParsedLine[] {
  const lines: ParsedLine[] = [];
  for (const row of rows.slice(headerRow + 1)) {
    const date = parseLooseDate(row[mapping.date]);
    if (!date) continue;
    const libelle = mapping.libelle >= 0 ? cellText(row[mapping.libelle]) : "";
    let credit = mapping.credit >= 0 ? parseLooseAmount(row[mapping.credit]) : Number.NaN;
    let debit = mapping.debit >= 0 ? parseLooseAmount(row[mapping.debit]) : Number.NaN;
    // Certaines banques (AGB) exportent les débits en négatif dans la colonne crédit.
    if (credit < 0 && !(debit > 0)) {
      debit = -credit;
      credit = Number.NaN;
    }
    if (debit < 0) debit = -debit;
    if (mapping.montant >= 0 && !(credit > 0) && !(debit > 0)) {
      const value = parseLooseAmount(row[mapping.montant]);
      if (value > 0) credit = value;
      else if (value < 0) debit = -value;
    }
    const mode = paymentModeOf(libelle, mapping.ref >= 0 ? cellText(row[mapping.ref]) : "");
    const push = (amount: number, sens: "CREDIT" | "DEBIT"): void => {
      const montant = round2(Math.abs(amount));
      lines.push({ key: statementLineKey({ date, sens, montant, libelle }), date, libelle, montant, sens, type: mode.type, numero: mode.numero });
    };
    if (credit > 0) push(credit, "CREDIT");
    else if (debit > 0) push(debit, "DEBIT");
  }
  return lines;
}

/** Texte des cellules (aperçu). */
export function previewRows(rows: SheetCell[][], from: number, count: number): string[][] {
  return rows.slice(from, from + count).map((row) => row.map(cellText));
}
