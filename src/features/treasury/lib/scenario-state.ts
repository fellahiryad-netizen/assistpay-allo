import { round2 } from "@/utils/amounts";
import { MAX_LINES_PER_SCENARIO, MAX_SCENARIOS, type DuplicateDecision, type Scenario, type ScenariosState, type SimLine } from "@/features/treasury/types";

/** Résultat d'une opération sur les scénarios : nouvel état ou refus. */
export type ScenarioUpdate = { ok: true; state: ScenariosState } | { ok: false; error: string; code: "VALIDATION" | "NOT_FOUND" | "CONFLICT" };

const notFound = (): ScenarioUpdate => ({ ok: false, error: "Ce scénario n'existe plus. Rechargez la page.", code: "NOT_FOUND" });

function withScenario(state: ScenariosState, id: string, change: (scenario: Scenario) => Scenario | string): ScenarioUpdate {
  const found = state.scenarios.find((scenario) => scenario.id === id);
  if (!found) return notFound();
  const next = change(found);
  if (typeof next === "string") return { ok: false, error: next, code: "VALIDATION" };
  return { ok: true, state: { ...state, scenarios: state.scenarios.map((scenario) => (scenario.id === id ? next : scenario)) } };
}

/** Crée un scénario vide (plafond de 20). Le scénario créé n'est pas activé. */
export function createScenario(state: ScenariosState, scenario: { id: string; nom: string; now: string; by: string }): ScenarioUpdate {
  if (state.scenarios.length >= MAX_SCENARIOS) return { ok: false, error: `Vous avez déjà ${MAX_SCENARIOS} scénarios : supprimez-en un avant d'en créer un autre.`, code: "VALIDATION" };
  if (state.scenarios.some((item) => item.nom.toLowerCase() === scenario.nom.trim().toLowerCase())) return { ok: false, error: "Un scénario porte déjà ce nom.", code: "VALIDATION" };
  const created: Scenario = { id: scenario.id, nom: scenario.nom.trim(), creeLe: scenario.now, creePar: scenario.by, lignes: [] };
  return { ok: true, state: { ...state, scenarios: [...state.scenarios, created] } };
}

/** Duplique un scénario et ses lignes (nouveaux identifiants de lignes fournis par l'appelant). */
export function duplicateScenario(state: ScenariosState, sourceId: string, copy: { id: string; nom: string; now: string; by: string; lineIds: readonly string[] }): ScenarioUpdate {
  const source = state.scenarios.find((item) => item.id === sourceId);
  if (!source) return notFound();
  const created = createScenario(state, copy);
  if (!created.ok) return created;
  const lignes = source.lignes.map((line, index) => ({ ...line, id: copy.lineIds[index] ?? `${copy.id}-${index}` }));
  return { ok: true, state: { ...created.state, scenarios: created.state.scenarios.map((item) => (item.id === copy.id ? { ...item, lignes } : item)) } };
}

/** Vérifie qu'un scénario existe avant son activation par un utilisateur (`null` : retour à la situation réelle, toujours permis). */
export function canActivate(state: ScenariosState, id: string | null): ScenarioUpdate {
  if (id !== null && !state.scenarios.some((scenario) => scenario.id === id)) return notFound();
  return { ok: true, state };
}

/** Supprime un scénario (désactive le scénario actif s'il s'agit de lui). */
export function deleteScenario(state: ScenariosState, id: string): ScenarioUpdate {
  if (!state.scenarios.some((scenario) => scenario.id === id)) return notFound();
  return { ok: true, state: { ...state, scenarios: state.scenarios.filter((scenario) => scenario.id !== id) } };
}

/** Vide les lignes d'un scénario (réinitialisation). */
export function clearScenario(state: ScenariosState, id: string): ScenarioUpdate {
  return withScenario(state, id, (scenario) => ({ ...scenario, lignes: [] }));
}

/** Ajoute une ligne (plafond de 50 par scénario). */
export function addLine(state: ScenariosState, scenarioId: string, line: SimLine): ScenarioUpdate {
  return withScenario(state, scenarioId, (scenario) => (scenario.lignes.length >= MAX_LINES_PER_SCENARIO ? `Ce scénario a déjà ${MAX_LINES_PER_SCENARIO} lignes : supprimez-en une avant d'en ajouter.` : { ...scenario, lignes: [...scenario.lignes, { ...line, montant: round2(line.montant) }] }));
}

/** Remplace une ligne existante (la décision de doublon est remise à zéro si le montant, la date, la période ou le type changent). */
export function updateLine(state: ScenariosState, scenarioId: string, line: SimLine): ScenarioUpdate {
  return withScenario(state, scenarioId, (scenario) => {
    const old = scenario.lignes.find((item) => item.id === line.id);
    if (!old) return "Cette ligne n'existe plus. Rechargez la page.";
    const moved = old.montant !== line.montant || old.date !== line.date || old.periode !== line.periode || old.type !== line.type;
    return { ...scenario, lignes: scenario.lignes.map((item) => (item.id === line.id ? { ...line, montant: round2(line.montant), decision: moved ? null : line.decision } : item)) };
  });
}

/** Supprime une ligne. */
export function removeLine(state: ScenariosState, scenarioId: string, lineId: string): ScenarioUpdate {
  return withScenario(state, scenarioId, (scenario) => (scenario.lignes.some((item) => item.id === lineId) ? { ...scenario, lignes: scenario.lignes.filter((item) => item.id !== lineId) } : "Cette ligne n'existe plus. Rechargez la page."));
}

/** Enregistre la décision de la comptable sur un doublon signalé : « ne pas compter » ou « garder quand même ». */
export function decideLine(state: ScenariosState, scenarioId: string, lineId: string, decision: DuplicateDecision | null): ScenarioUpdate {
  return withScenario(state, scenarioId, (scenario) => (scenario.lignes.some((item) => item.id === lineId) ? { ...scenario, lignes: scenario.lignes.map((item) => (item.id === lineId ? { ...item, decision } : item)) } : "Cette ligne n'existe plus. Rechargez la page."));
}

/** Scénario actif d'un utilisateur (son identifiant lu dans `tresorerie:actif:<id>`), ou null s'il n'en a aucun ou si le scénario a été supprimé. */
export function activeScenario(state: ScenariosState, activeId: string | null): Scenario | null {
  return activeId === null ? null : (state.scenarios.find((scenario) => scenario.id === activeId) ?? null);
}
