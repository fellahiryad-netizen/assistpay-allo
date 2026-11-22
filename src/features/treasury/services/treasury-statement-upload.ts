import { can } from "@/features/access/services/access-rules";
import type { AuthUser } from "@/features/access/types";
import { analyseStatement, previewStatement, type UploadedFile } from "@/features/statement/services/statement-service";
import { requireTreasury } from "@/features/treasury/services/treasury-access";
import type { BalanceRecordOutcome } from "@/features/treasury/services/treasury-import";
import { fail, ok, type ActionResult } from "@/types";

/** Résultat de l'import d'un relevé AGB depuis l'onglet Trésorerie. */
export interface TreasuryImportResult {
  fileName: string;
  /** Lignes d'opérations lues dans le fichier. */
  linesTotal: number;
  /** Lignes déjà connues (importées auparavant). */
  alreadyKnown: number;
  /** Lignes jamais vues jusque-là. */
  newLines: number;
  /** Lignes identiques (même date, montant et libellé) regroupées en une seule par le flux d'import existant. */
  grouped: number;
  /** Frais bancaires écartés de l'analyse. */
  bankFees: number;
  /** Paiements « à traiter » et rapprochements à valider dans le module Relevé bancaire. */
  toProcess: number;
  toValidate: number;
  /** Issue de la lecture du solde ; null si l'analyse n'a pas pu la fournir. */
  balance: BalanceRecordOutcome | null;
}

/** Message affiché à qui a l'accès Trésorerie mais pas la modification du Relevé bancaire. */
export const NO_STATEMENT_ACCESS_MESSAGE =
  "L'import d'un relevé passe par le module « Relevé bancaire », que votre profil ne peut pas modifier. Demandez ce droit à l'administrateur, ou faites importer le relevé par un collègue qui l'a.";

/**
 * Importe un relevé AGB depuis l'onglet Trésorerie en réutilisant exactement le flux du relevé bancaire : lecture du fichier, colonnes devinées,
 * analyse et rapprochement (`analyseStatement`), journal « Import du relevé bancaire », puis enregistrement du solde « Solde FIN AU ».
 * Deux droits sont exigés : l'accès Trésorerie et la modification du module Relevé bancaire (message clair sinon).
 * Aucune logique d'import n'est dupliquée ici : ce service ne fait que chaîner l'aperçu et l'analyse existants.
 */
export async function importStatementFromTreasury(actor: AuthUser, file: UploadedFile): Promise<ActionResult<TreasuryImportResult>> {
  const guard = requireTreasury(actor, "view");
  if (!guard.success) return guard;
  if (!can(actor, "RELEVE", "EDIT")) return fail(NO_STATEMENT_ACCESS_MESSAGE, "FORBIDDEN");
  const preview = await previewStatement(actor, file);
  if (!preview.success) return preview;
  const analysed = await analyseStatement(actor, file, preview.data.mapping);
  if (!analysed.success) return analysed;
  const analysis = analysed.data;
  const distinct = analysis.total - analysis.bankFees.count - (analysis.freshness?.grouped ?? 0);
  const newLines = analysis.freshness?.brandNew ?? Math.max(0, analysis.total - analysis.bankFees.count - analysis.alreadyImported);
  const alreadyKnown = Math.max(0, distinct - newLines);
  return ok({
    fileName: file.name,
    linesTotal: analysis.total,
    alreadyKnown,
    newLines,
    grouped: analysis.freshness?.grouped ?? 0,
    bankFees: analysis.bankFees.count,
    toProcess: analysis.todo.length,
    toValidate: analysis.proposals.length,
    balance: analysis.balance ?? null,
  });
}
