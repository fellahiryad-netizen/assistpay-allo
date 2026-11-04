import { can, requireAccess } from "@/features/access/services/access-rules";
import type { AuthUser } from "@/features/access/types";
import { advanceTable } from "@/features/partners/services/advance-table";
import type { RegulOptions } from "@/features/regul/schemas";
import { analyseRegul, parseRegulFile, REGUL_LABELS, type RegulAnalysis, type RegulFile, type RegulMonthInput } from "@/features/regul/services/regul-engine";
import { writeRegulWorkbook } from "@/features/regul/services/regul-export";
import { logAction } from "@/features/journal/services/journal-service";
import { readCsvRows, readWorkbook } from "@/lib/spreadsheet";
import { fail, ok, type ActionResult } from "@/types";

/** Fichier reçu (nom et contenu). */
export interface RegulUpload {
  name: string;
  bytes: Uint8Array;
}

/** Résultat de l'analyse : calculs et origine des avances proposées. */
export interface RegulResult {
  analysis: RegulAnalysis;
  /** Avances reprises des factures d'avance CAAT d'AssistPay (par mois). */
  avancesFactures: Record<number, number>;
}

function readInputs(raw: string | undefined): Record<number, { total?: number; avance?: number }> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const out: Record<number, { total?: number; avance?: number }> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value !== "object" || value === null) continue;
      const rec = value as Record<string, unknown>;
      const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
      out[Number(key)] = { total: num(rec.total), avance: num(rec.avance) };
    }
    return out;
  } catch {
    return {};
  }
}

/** Calcule la régularisation 10 % HT + TVA d'une succursale à partir des fichiers déposés. */
export async function runRegul(actor: AuthUser, files: RegulUpload[], options: RegulOptions): Promise<ActionResult<RegulResult>> {
  const guard = requireAccess(actor, "FCLI");
  if (!guard.success) return guard;
  if (!files.length) return fail("Déposez au moins un fichier de production.", "VALIDATION");
  const parsed: RegulFile[] = [];
  const unread: string[] = [];
  for (const file of files) {
    try {
      const sheets = /\.(csv|txt)$/i.test(file.name) ? [{ name: file.name, rows: readCsvRows(file.bytes) }] : readWorkbook(file.bytes);
      const result = parseRegulFile(file.name, sheets);
      if (result) parsed.push(result);
      else unread.push(file.name);
    } catch {
      unread.push(file.name);
    }
  }
  if (!parsed.length) return fail("Aucun fichier lisible : les colonnes IMMATRICULATION, POLICE, PRIME, PART_ASSISTEUR et CODE_AGENCE sont introuvables.", "VALIDATION");

  const avancesFactures: Record<number, number> = {};
  const table = await advanceTable(actor, "CAAT", options.annee);
  if (table.success) {
    const row = table.data.rows.find((r) => r.key === options.succursale);
    row?.months.forEach((cell, index) => {
      if (cell.billed > 0) avancesFactures[index + 1] = cell.billed;
    });
  }
  const typed = readInputs(options.saisies);
  const inputs: Record<number, RegulMonthInput> = {};
  for (let m = 1; m <= 12; m++) {
    const t = typed[m];
    inputs[m] = { avance: t?.avance ?? avancesFactures[m] ?? 0, total: t?.total };
  }
  return ok({ analysis: analyseRegul(options.succursale, options.periode, options.annee, parsed, unread, inputs), avancesFactures });
}

/** Classeur de régularisation prêt à envoyer (Feuil1, polices valides, annulées, changements de garantie, contrôle agences, méthodologie). */
export async function exportRegul(actor: AuthUser, files: RegulUpload[], options: RegulOptions): Promise<ActionResult<{ name: string; bytes: Uint8Array }>> {
  if (!can(actor, "A_EXPORT", "EDIT")) return fail("Vous n'avez pas le droit d'exporter.", "FORBIDDEN");
  const result = await runRegul(actor, files, options);
  if (!result.success) return result;
  const bytes = writeRegulWorkbook(result.data.analysis);
  await logAction(actor, "Export régularisation CAAT", `${REGUL_LABELS[options.succursale] ?? options.succursale} ${options.periode} ${options.annee}`);
  return ok({ name: `REGUL_10_${options.succursale.replace(/ /g, "_")}_${options.periode}_${options.annee}.xlsx`, bytes });
}
