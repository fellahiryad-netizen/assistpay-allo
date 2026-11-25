/** Ligne du relevé proposée pour une écriture RH. */
export interface HrCandidateLine {
  id: string;
  /** Date `AAAA-MM-JJ`. */
  date: string;
  libelle: string;
  numero: string;
  montant: number;
  sens: "DEBIT" | "CREDIT";
  /** Nature de l'opération au relevé : CHEQUE, VIRMT, VRSMT ou vide. */
  type: string;
}

/** Ligne proposée avec son écart au montant de l'écriture. */
export interface HrRankedLine extends HrCandidateLine {
  /** Montant du relevé moins montant de l'écriture (DA, deux décimales). */
  ecart: number;
  /** Nombre de jours entre la date de paiement saisie et le relevé (null si l'écriture n'a pas de date). */
  jours: number | null;
  /** Même montant au centime près. */
  exact: boolean;
}

const DAY = 86_400_000;

function daysBetween(first: string, second: string): number {
  return Math.round(Math.abs(Date.parse(`${first}T00:00:00Z`) - Date.parse(`${second}T00:00:00Z`)) / DAY);
}

/** Sens du relevé attendu : un paiement RH est un débit, un retour / remboursement est un crédit. */
export function expectedLineSens(sens: "PAIEMENT" | "RETOUR"): "DEBIT" | "CREDIT" {
  return sens === "RETOUR" ? "CREDIT" : "DEBIT";
}

/**
 * Lignes du relevé à proposer pour affecter une écriture : même sens, montant à moins de 10 % près.
 * Classées : montant exact d'abord, puis plus petit écart, puis date la plus proche. `limit` lignes au plus.
 */
export function rankCandidateLines(entry: { sens: "PAIEMENT" | "RETOUR"; montant: number; date: string | null }, lines: readonly HrCandidateLine[], limit = 12): HrRankedLine[] {
  const sens = expectedLineSens(entry.sens);
  const ranked: HrRankedLine[] = [];
  for (const line of lines) {
    if (line.sens !== sens) continue;
    const ecart = Math.round((line.montant - entry.montant) * 100) / 100;
    if (entry.montant > 0 && Math.abs(ecart) / entry.montant > 0.1) continue;
    ranked.push({ ...line, ecart, jours: entry.date ? daysBetween(entry.date, line.date) : null, exact: Math.abs(ecart) < 0.005 });
  }
  return ranked
    .sort((a, b) => Number(b.exact) - Number(a.exact) || Math.abs(a.ecart) - Math.abs(b.ecart) || (a.jours ?? 9999) - (b.jours ?? 9999) || b.date.localeCompare(a.date))
    .slice(0, limit);
}

/** Champs que l'affectation peut compléter sur l'écriture (uniquement ceux qui sont vides). */
export interface HrFillPatch {
  date?: string;
  mode?: "VIRMT" | "CHEQUE";
  cheque?: string;
}

/** Ce que la ligne du relevé apporte à une écriture incomplète : date de paiement, mode de règlement, numéro de chèque. */
export function fillFromLine(entry: { date: string | null; mode: string; cheque: string }, line: Pick<HrCandidateLine, "date" | "numero" | "type">): HrFillPatch {
  const patch: HrFillPatch = {};
  if (!entry.date) patch.date = line.date;
  const mode = entry.mode || (line.type === "CHEQUE" ? "CHEQUE" : line.type === "VIRMT" || line.type === "VRSMT" ? "VIRMT" : "");
  if (!entry.mode && (mode === "CHEQUE" || mode === "VIRMT")) patch.mode = mode;
  if (mode === "CHEQUE" && !entry.cheque && line.numero) patch.cheque = line.numero;
  return patch;
}
