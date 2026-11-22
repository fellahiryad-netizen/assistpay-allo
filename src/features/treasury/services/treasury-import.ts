import type { SheetCell } from "@/lib/spreadsheet";
import type { AuthUser } from "@/features/access/types";
import { logAction } from "@/features/journal/services/journal-service";
import { applyRefusedImport, applyValidImport, type ImportDecision } from "@/features/treasury/lib/balance-state";
import { parseStatementBalance } from "@/features/treasury/lib/statement-balance";
import { parseSolde } from "@/features/treasury/lib/store-parse";
import { KEY_SOLDE, updateState } from "@/features/treasury/services/treasury-store";
import { fail, ok, type ActionResult } from "@/types";
import { formatDA, formatDate } from "@/utils/format";

/** Issue de l'enregistrement du solde d'un relevé. */
export interface BalanceRecordOutcome {
  status: "enregistre" | "ignore" | "refuse";
  message: string;
}

/**
 * Enregistre le solde d'un relevé importé (appelé après l'import du relevé bancaire, sans en changer le comportement).
 * Fichier sans la structure AGB : rien n'est écrit. Compte différent de 2737851208 ou relevé incohérent : le refus est tracé et le solde déjà enregistré reste.
 * Relevé plus ancien que le solde enregistré : jamais de remplacement. Ne lève jamais d'exception : un échec est renvoyé en résultat et n'interrompt pas l'import.
 * Ce n'est pas une action de consultation : aucun solde n'est renvoyé, le contrôle d'accès de l'import (relevé bancaire) s'applique en amont.
 */
export async function recordStatementBalance(actor: AuthUser, rows: SheetCell[][], fileName: string): Promise<ActionResult<BalanceRecordOutcome>> {
  try {
    const parsed = parseStatementBalance(rows);
    const now = new Date().toISOString();
    if (parsed.kind === "refused" && parsed.reason === "structure") return ok({ status: "ignore", message: parsed.message });
    let decision: ImportDecision | null = null;
    const saved = await updateState(KEY_SOLDE, parseSolde, (state) => {
      if (parsed.kind === "refused") return { ok: true, state: applyRefusedImport(state, { reason: parsed.reason, message: parsed.message, fileName, at: now }) };
      decision = applyValidImport(state, parsed.balance, { fileName, importedAt: now, importedBy: actor.name });
      return { ok: true, state: decision.state };
    });
    if (!saved.success) return fail(saved.error, saved.code);
    if (parsed.kind === "refused") {
      await logAction(actor, "Solde de trésorerie refusé", `${fileName} : ${parsed.message}`, true);
      return ok({ status: "refuse", message: parsed.message });
    }
    const outcome = decision as ImportDecision | null;
    if (outcome && outcome.action === "ignored") {
      await logAction(actor, "Solde de trésorerie non remplacé", outcome.message, true);
      return ok({ status: "ignore", message: outcome.message });
    }
    await logAction(actor, "Solde de trésorerie mis à jour", `${fileName} : solde ${formatDA(parsed.balance.balance)} au ${formatDate(parsed.balance.balanceDate)}, ${parsed.balance.rowCount} opérations`, true);
    return ok({ status: "enregistre", message: `Solde ${formatDA(parsed.balance.balance)} au ${formatDate(parsed.balance.balanceDate)}.` });
  } catch (error) {
    console.error("[tresorerie] enregistrement du solde :", error);
    return fail("Le solde de trésorerie n'a pas pu être enregistré.", "DATABASE");
  }
}
