import type { AuthUser } from "@/features/access/types";
import { logAction } from "@/features/journal/services/journal-service";
import { resolveBalance } from "@/features/treasury/lib/balance-state";
import { findDuplicates } from "@/features/treasury/lib/duplicates";
import { addLine, canActivate, clearScenario, createScenario, decideLine, deleteScenario, duplicateScenario, removeLine, updateLine, type ScenarioUpdate } from "@/features/treasury/lib/scenario-state";
import { parseActive, parseScenarios, parseSolde } from "@/features/treasury/lib/store-parse";
import type {
  LineDecisionInput,
  LineIdInput,
  ScenarioActivateInput,
  ScenarioCreateInput,
  ScenarioDuplicateInput,
  ScenarioIdInput,
  SimLineInput,
  SimLineUpdateInput,
} from "@/features/treasury/schemas";
import { requireTreasury } from "@/features/treasury/services/treasury-access";
import { loadDuplicateSources } from "@/features/treasury/services/treasury-sources";
import { KEY_SCENARIOS, KEY_SOLDE, keyActive, readState, updateState } from "@/features/treasury/services/treasury-store";
import { SIM_CONFIRM_AMOUNT, SIM_TYPE_LABELS, type ScenariosState, type SimLine } from "@/features/treasury/types";
import { fail, ok, type ActionResult } from "@/types";
import { round2 } from "@/utils/amounts";
import { formatDA, formatDate } from "@/utils/format";

/**
 * Applique une modification des scénarios, sûre en concurrence (écriture conditionnelle sur `updatedAt`, 5 tentatives),
 * puis l'écrit au journal d'administration. Les lignes simulées ne touchent jamais ni les factures, ni les demandes, ni les écritures RH.
 */
async function changeScenarios(actor: AuthUser, action: string, objet: string | ((state: ScenariosState) => string), compute: (state: ScenariosState) => ScenarioUpdate): Promise<ActionResult<ScenariosState>> {
  const guard = requireTreasury(actor, "simulate");
  if (!guard.success) return guard;
  try {
    const saved = await updateState(KEY_SCENARIOS, parseScenarios, (state) => {
      const next = compute(state);
      return next.ok ? { ok: true, state: next.state } : { ok: false, error: next.error, code: next.code };
    });
    if (!saved.success) return saved;
    await logAction(actor, action, typeof objet === "string" ? objet : objet(saved.data), true);
    return saved;
  } catch (error) {
    console.error("[tresorerie] scénarios :", error);
    return fail("Le scénario n'a pas pu être enregistré.", "DATABASE");
  }
}

const nameOf = (state: ScenariosState, id: string): string => state.scenarios.find((scenario) => scenario.id === id)?.nom ?? id;

/** Crée un scénario vide (20 au plus). */
export async function createScenarioEntry(actor: AuthUser, input: ScenarioCreateInput): Promise<ActionResult<{ id: string }>> {
  const id = crypto.randomUUID();
  const result = await changeScenarios(actor, "Scénario de trésorerie créé", input.nom, (state) => createScenario(state, { id, nom: input.nom, now: new Date().toISOString(), by: actor.name }));
  return result.success ? ok({ id }) : result;
}

/** Duplique un scénario avec ses lignes. */
export async function duplicateScenarioEntry(actor: AuthUser, input: ScenarioDuplicateInput): Promise<ActionResult<{ id: string }>> {
  const id = crypto.randomUUID();
  const result = await changeScenarios(actor, "Scénario de trésorerie dupliqué", input.nom, (state) =>
    duplicateScenario(state, input.scenarioId, { id, nom: input.nom, now: new Date().toISOString(), by: actor.name, lineIds: Array.from({ length: 50 }, () => crypto.randomUUID()) }),
  );
  return result.success ? ok({ id }) : result;
}

/**
 * Active un scénario pour l'utilisateur qui le demande, ou le ramène à la situation réelle. L'activation est personnelle (clé `tresorerie:actif:<utilisateur>`) :
 * elle ne change rien à ce que voient les autres, la Direction par exemple ne voit jamais un scénario activé par la comptable.
 */
export async function activateScenarioEntry(actor: AuthUser, input: ScenarioActivateInput): Promise<ActionResult<true>> {
  const guard = requireTreasury(actor, "simulate");
  if (!guard.success) return guard;
  try {
    const scenarios = await readState(KEY_SCENARIOS, parseScenarios);
    const check = canActivate(scenarios, input.scenarioId);
    if (!check.ok) return fail(check.error, check.code);
    const saved = await updateState(keyActive(actor.id), parseActive, () => ({ ok: true, state: { scenarioId: input.scenarioId } }));
    if (!saved.success) return saved;
    await logAction(actor, input.scenarioId ? "Scénario de trésorerie activé" : "Retour à la situation réelle", input.scenarioId ? nameOf(scenarios, input.scenarioId) : "situation réelle", true);
    return ok(true);
  } catch (error) {
    console.error("[tresorerie] activation :", error);
    return fail("Le scénario n'a pas pu être activé.", "DATABASE");
  }
}

/** Supprime un scénario. */
export async function deleteScenarioEntry(actor: AuthUser, input: ScenarioIdInput): Promise<ActionResult<true>> {
  const result = await changeScenarios(actor, "Scénario de trésorerie supprimé", input.scenarioId, (state) => deleteScenario(state, input.scenarioId));
  return result.success ? ok(true) : result;
}

/** Réinitialise un scénario : toutes ses lignes sont retirées. */
export async function clearScenarioEntry(actor: AuthUser, input: ScenarioIdInput): Promise<ActionResult<true>> {
  const result = await changeScenarios(actor, "Scénario de trésorerie réinitialisé", input.scenarioId, (state) => clearScenario(state, input.scenarioId));
  return result.success ? ok(true) : result;
}

async function balanceDateOf(): Promise<string | null> {
  return resolveBalance(await readState(KEY_SOLDE, parseSolde))?.date ?? null;
}

function checkLine(input: SimLineInput, balanceDate: string | null): string | null {
  if (!balanceDate) return "Aucun solde n'est disponible : importez d'abord un relevé AGB.";
  if (input.date < balanceDate) return `La date prévue ne peut pas précéder la date du solde (${formatDate(balanceDate)}).`;
  if (input.montant > SIM_CONFIRM_AMOUNT && input.confirmer !== true) return `Le montant dépasse ${formatDA(SIM_CONFIRM_AMOUNT)} : confirmez-le pour l'enregistrer.`;
  return null;
}

const toLine = (id: string, input: SimLineInput, decision: SimLine["decision"]): SimLine => ({ id, type: input.type, libelle: input.libelle, periode: input.periode, montant: round2(input.montant), date: input.date, mode: input.mode, certitude: input.certitude, decision });

/** Ajoute une ligne de simulation (50 au plus par scénario) et renvoie les doublons éventuels avec le RH et le relevé. Rien n'est supprimé ni refusé pour doublon. */
export async function addSimulationLine(actor: AuthUser, input: SimLineInput): Promise<ActionResult<{ lineId: string; warnings: string[] }>> {
  const guard = requireTreasury(actor, "simulate");
  if (!guard.success) return guard;
  const balanceDate = await balanceDateOf();
  const problem = checkLine(input, balanceDate);
  if (problem) return fail(problem, "VALIDATION");
  const lineId = crypto.randomUUID();
  const line = toLine(lineId, input, null);
  const result = await changeScenarios(actor, "Ligne de simulation ajoutée", `${SIM_TYPE_LABELS[input.type]} ${input.libelle} : ${formatDA(input.montant)} le ${formatDate(input.date)}`, (state) => addLine(state, input.scenarioId, line));
  if (!result.success) return result;
  const loaded = await loadDuplicateSources(actor);
  if (!loaded.success) return loaded;
  const sources = loaded.data;
  return ok({ lineId, warnings: findDuplicates(line, sources.hr, sources.debits, balanceDate ?? input.date).map((hit) => hit.message) });
}

/** Modifie une ligne de simulation (la décision sur un doublon est remise à zéro si le montant, la date, la période ou le type changent). */
export async function updateSimulationLine(actor: AuthUser, input: SimLineUpdateInput): Promise<ActionResult<{ warnings: string[] }>> {
  const guard = requireTreasury(actor, "simulate");
  if (!guard.success) return guard;
  const balanceDate = await balanceDateOf();
  const problem = checkLine(input, balanceDate);
  if (problem) return fail(problem, "VALIDATION");
  const line = toLine(input.lineId, input, null);
  let kept: SimLine = line;
  const result = await changeScenarios(actor, "Ligne de simulation modifiée", `${SIM_TYPE_LABELS[input.type]} ${input.libelle} : ${formatDA(input.montant)} le ${formatDate(input.date)}`, (state) => {
    const current = state.scenarios.find((scenario) => scenario.id === input.scenarioId)?.lignes.find((item) => item.id === input.lineId);
    kept = { ...line, decision: current?.decision ?? null };
    return updateLine(state, input.scenarioId, kept);
  });
  if (!result.success) return result;
  const finalLine = result.data.scenarios.find((scenario) => scenario.id === input.scenarioId)?.lignes.find((item) => item.id === input.lineId) ?? kept;
  if (finalLine.decision !== null) return ok({ warnings: [] });
  const loaded = await loadDuplicateSources(actor);
  if (!loaded.success) return loaded;
  const sources = loaded.data;
  return ok({ warnings: findDuplicates(finalLine, sources.hr, sources.debits, balanceDate ?? input.date).map((hit) => hit.message) });
}

/** Supprime une ligne de simulation. */
export async function removeSimulationLine(actor: AuthUser, input: LineIdInput): Promise<ActionResult<true>> {
  const result = await changeScenarios(actor, "Ligne de simulation supprimée", `${input.scenarioId} / ${input.lineId}`, (state) => removeLine(state, input.scenarioId, input.lineId));
  return result.success ? ok(true) : result;
}

/** « C'est un doublon, ne pas compter » ou « Garder quand même » : la ligne reste enregistrée, seule sa prise en compte change. */
export async function decideSimulationLine(actor: AuthUser, input: LineDecisionInput): Promise<ActionResult<true>> {
  const label = input.decision === "ignorer" ? "Doublon : ligne non comptée" : input.decision === "garder" ? "Doublon écarté : ligne gardée" : "Décision sur un doublon retirée";
  const result = await changeScenarios(actor, label, `${input.scenarioId} / ${input.lineId}`, (state) => decideLine(state, input.scenarioId, input.lineId, input.decision));
  return result.success ? ok(true) : result;
}
