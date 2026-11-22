import type { SheetCell } from "@/lib/spreadsheet";

/** Montant au format AGB : espace insécable (ou fine) en séparateur de milliers, virgule décimale. */
export function fmt(value: number, sep = " "): string {
  const [int = "", dec = "00"] = Math.abs(value).toFixed(2).split(".");
  return `${value < 0 ? "-" : ""}${int.replace(/\B(?=(\d{3})+(?!\d))/g, sep)},${dec}`;
}

export interface Op {
  date: string;
  label: string;
  /** Positif : crédit, négatif : débit. */
  amount: number;
}

/** Relevé synthétique au format AGB : plus récent en tête, solde départ en point décimal, pied de page avec « Solde FIN AU ». */
export function statement(ops: Op[], options: { account?: string; opening?: number; sep?: string; tamper?: (rows: SheetCell[][]) => void; sens?: string } = {}): SheetCell[][] {
  const opening = options.opening ?? 1_000_000;
  const oldestFirst = [...ops].reverse();
  let running = opening;
  const lines = oldestFirst.map((op) => {
    running = Math.round((running + op.amount) * 100) / 100;
    return { op, balance: running };
  });
  const frDate = (iso: string): string => iso.split("-").reverse().join("/");
  const row = (cells: Record<number, SheetCell>): SheetCell[] => Array.from({ length: 20 }, (_, index) => cells[index] ?? "");
  const rows: SheetCell[][] = [
    row({}),
    row({ 0: "Date:22/11/2026" }),
    row({ 0: "Client :EURL ALLO  ASSISTANCE   " }),
    row({ 0: `Numéro de compte : ${options.account ?? "2737851208"}` }),
    row({ 0: "RELEVE DE COMPTE CLIENTELE" }),
    row({ 1: "Date Opération", 3: "Date Valeur", 5: "Référence", 6: "Libellé", 9: "Mon", 10: "Débit", 12: "Crédit", 15: "Solde" }),
    row({ 1: frDate(oldestFirst[0]?.date ?? "2026-01-04"), 6: "solde depart", 15: opening.toFixed(4) }),
    ...[...lines].reverse().map(({ op, balance }) =>
      row({ 1: frDate(op.date), 3: frDate(op.date), 6: op.label, 9: "DZD", 10: fmt(op.amount < 0 ? op.amount : 0, options.sep), 12: fmt(op.amount > 0 ? op.amount : 0, options.sep), 15: fmt(balance, options.sep) }),
    ),
  ];
  const credits = ops.filter((op) => op.amount > 0).reduce((sum, op) => sum + op.amount, 0);
  const debits = ops.filter((op) => op.amount < 0).reduce((sum, op) => sum + op.amount, 0);
  rows.push(row({ 13: "somme crédit:", 16: credits.toFixed(2) }));
  rows.push(row({ 0: "Solde FIN AU", 2: "2026/11/22", 4: running.toFixed(4), 7: options.sens ?? "CT" }));
  rows.push(row({}));
  rows.push(row({ 13: "somme débit:", 16: debits.toFixed(2) }));
  options.tamper?.(rows);
  return rows;
}

export const OPS: Op[] = [
  { date: "2026-11-19", label: "Commission Virement RTGS AGBONLINE", amount: -2_000 },
  { date: "2026-11-19", label: "Execution virement en Faveur: CNAS", amount: -1_493_343.36 },
  { date: "2026-11-18", label: "Virement /o :CAAT", amount: 2_627_758 },
  { date: "2026-11-18", label: "Virement /o :CAAT", amount: 2_627_758 },
  { date: "2026-11-02", label: "PAIEMENT CHEQUE N° TL-7064740", amount: -13_916_005 },
  { date: "2026-10-30", label: "Virement /o :GAM", amount: 20_000_000 },
];

