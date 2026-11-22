import { describe, expect, it } from "vitest";
import { hrDateAnomalies, ledgerGap } from "@/features/treasury/lib/controls";
import { findDuplicates, suggestFor, type HrLite } from "@/features/treasury/lib/duplicates";
import { activateScenario, addLine, clearScenario, createScenario, decideLine, deleteScenario, duplicateScenario, removeLine, updateLine, type ScenarioUpdate } from "@/features/treasury/lib/scenario-state";
import { DEFAULT_SETTINGS, parseScenarios, parseSettings } from "@/features/treasury/lib/store-parse";
import { MAX_LINES_PER_SCENARIO, MAX_SCENARIOS, type ScenariosState, type SimLine } from "@/features/treasury/types";
import { simLineSchema, treasurySettingsSchema } from "@/features/treasury/schemas";

const hr: HrLite[] = [
  { id: "g50-oct", nature: "G50", monthKey: "2026-10", date: "2026-11-19", montant: 22_752_053, libelle: "G50 octobre 2026", beneficiaire: "Receveur des impôts Chéraga" },
  { id: "g50-sep", nature: "G50", monthKey: "2026-09", date: "2026-11-04", montant: 13_916_005, libelle: "G50 septembre", beneficiaire: "Receveur des impôts" },
  { id: "g50-aug", nature: "G50", monthKey: "2026-08", date: "2026-10-12", montant: 12_925_627, libelle: "", beneficiaire: "" },
  { id: "cnas-sep", nature: "CNAS", monthKey: "2026-09", date: "2026-10-15", montant: 1_500_000, libelle: "", beneficiaire: "CNAS KOLEA" },
  { id: "cnas-sep-bis", nature: "CNAS", monthKey: "2026-09", date: "2026-09-08", montant: 1_420_685, libelle: "", beneficiaire: "CNAS KOLEA" },
];
const line = (overrides: Partial<SimLine> = {}): SimLine => ({ id: "l1", type: "G50", libelle: "G50 octobre", periode: "2026-10", montant: 22_752_053, date: "2026-11-30", mode: "CHEQUE", certitude: "CERTAIN", decision: null, ...overrides });

describe("anti-doublon avec le RH et le relevé", () => {
  it("même nature et même mois : le G50 d'octobre est déjà dans le RH", () => {
    const hits = findDuplicates({ type: "G50", periode: "2026-10", date: "2026-12-10", montant: 20_000_000 }, hr, [], "2026-11-22");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.kind).toBe("rh");
    expect(hits[0]?.message).toContain("semble déjà enregistré dans le RH");
    expect(hits[0]?.message).toContain("22 752 053,00");
  });
  it("montant à ± 1 % et ± 45 jours, quelle que soit la nature", () => {
    const near = findDuplicates({ type: "AUTRE", periode: "", date: "2026-12-25", montant: 22_800_000 }, hr, [], "2026-11-22");
    expect(near.map((hit) => hit.refId)).toEqual(["g50-oct"]);
    expect(findDuplicates({ type: "AUTRE", periode: "", date: "2027-02-25", montant: 22_752_053 }, hr, [], "2026-11-22")).toEqual([]);
    expect(findDuplicates({ type: "AUTRE", periode: "", date: "2026-12-25", montant: 23_500_000 }, hr, [], "2026-11-22")).toEqual([]);
  });
  it("période différente et montant éloigné : pas de doublon", () => {
    expect(findDuplicates({ type: "G50", periode: "2026-11", date: "2026-12-30", montant: 18_000_000 }, hr, [], "2026-11-22")).toEqual([]);
  });
  it("débit du relevé postérieur à la date du solde : « déjà passé en banque »", () => {
    const debits = [
      { date: "2026-11-24", libelle: "PAIEMENT CHEQUE G50 RECEVEUR", numero: "", montant: 22_752_053 },
      { date: "2026-11-10", libelle: "PAIEMENT CHEQUE G50", numero: "", montant: 22_752_053 },
    ];
    const hits = findDuplicates({ type: "CNAS", periode: "2026-10", date: "2026-11-30", montant: 22_752_053 }, [], debits, "2026-11-22");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.kind).toBe("banque");
    expect(hits[0]?.message).toContain("Déjà passé en banque");
  });
  it("suggestions : dernier mois connu et moyenne, jamais appliquées seules", () => {
    const suggestion = suggestFor("G50", hr);
    expect(suggestion.last).toEqual({ montant: 22_752_053, label: "octobre 2026" });
    expect(suggestion.average?.months).toBe(3);
    expect(suggestion.average?.montant).toBeCloseTo((22_752_053 + 13_916_005 + 12_925_627) / 3, 1);
    expect(suggestFor("CNAS", hr).last?.montant).toBe(2_920_685);
    expect(suggestFor("AUTRE", hr)).toEqual({ last: null, average: null });
  });
});

describe("contrôles en lecture seule", () => {
  it("anomalies RH : date absurde (2028) et date manquante", () => {
    const anomalies = hrDateAnomalies(
      [
        { id: "1", nature: "CNAS", libelle: "Cnas févr 2026", montant: 878_323.54, date: "2028-03-05" },
        { id: "2", nature: "Salaire", libelle: "août", montant: 3_003_587.46, date: null },
        { id: "3", nature: "G50", libelle: "ok", montant: 1, date: "2026-11-19" },
      ],
      "2026-11-22",
    );
    expect(anomalies.map((item) => [item.id, item.reason])).toEqual([["1", "date_absurde"], ["2", "sans_date"]]);
  });
  it("écart relevé / journal du CRM : 3 356 145,50 DA", () => {
    expect(ledgerGap(120_850_558.05, 71_916_633.97, 864_265_277.16, 818_687_498.58)).toEqual({ recomputed: 117_494_412.55, gap: 3_356_145.5 });
  });
});

describe("scénarios : opérations pures", () => {
  const empty: ScenariosState = { actif: null, scenarios: [] };
  const ok = (update: ScenarioUpdate): ScenariosState => {
    if (!update.ok) throw new Error(update.error);
    return update.state;
  };
  const made = (): ScenariosState => ok(createScenario(empty, { id: "s1", nom: "Fin novembre", now: "2026-11-22T10:00:00.000Z", by: "Comptable" }));

  it("crée, active, duplique, vide et supprime", () => {
    let state = made();
    state = ok(addLine(state, "s1", line()));
    state = ok(activateScenario(state, "s1"));
    expect(state.actif).toBe("s1");
    state = ok(duplicateScenario(state, "s1", { id: "s2", nom: "Cas prudent", now: "x", by: "Comptable", lineIds: ["n1"] }));
    expect(state.scenarios.find((s) => s.id === "s2")?.lignes.map((l) => l.id)).toEqual(["n1"]);
    state = ok(clearScenario(state, "s1"));
    expect(state.scenarios[0]?.lignes).toEqual([]);
    state = ok(deleteScenario(state, "s1"));
    expect(state.actif).toBeNull();
    expect(state.scenarios.map((s) => s.id)).toEqual(["s2"]);
  });
  it("refuse un nom déjà pris, un scénario inconnu et dépasse les plafonds", () => {
    const state = made();
    expect(createScenario(state, { id: "x", nom: "fin novembre", now: "", by: "" }).ok).toBe(false);
    expect(activateScenario(state, "inconnu")).toMatchObject({ ok: false, code: "NOT_FOUND" });
    let many = empty;
    for (let index = 0; index < MAX_SCENARIOS; index += 1) many = ok(createScenario(many, { id: `s${index}`, nom: `S${index}`, now: "", by: "" }));
    expect(createScenario(many, { id: "plus", nom: "Trop", now: "", by: "" }).ok).toBe(false);
    let lines = made();
    for (let index = 0; index < MAX_LINES_PER_SCENARIO; index += 1) lines = ok(addLine(lines, "s1", line({ id: `l${index}` })));
    expect(addLine(lines, "s1", line({ id: "de-trop" })).ok).toBe(false);
  });
  it("décision sur un doublon : conservée, remise à zéro si le montant change ; rien n'est supprimé", () => {
    let state = ok(addLine(made(), "s1", line()));
    state = ok(decideLine(state, "s1", "l1", "ignorer"));
    expect(state.scenarios[0]?.lignes[0]?.decision).toBe("ignorer");
    state = ok(updateLine(state, "s1", line({ libelle: "G50 octobre (corrigé)", decision: "ignorer" })));
    expect(state.scenarios[0]?.lignes[0]?.decision).toBe("ignorer");
    state = ok(updateLine(state, "s1", line({ montant: 1, decision: "ignorer" })));
    expect(state.scenarios[0]?.lignes[0]?.decision).toBeNull();
    expect(state.scenarios[0]?.lignes).toHaveLength(1);
    state = ok(removeLine(state, "s1", "l1"));
    expect(state.scenarios[0]?.lignes).toHaveLength(0);
  });
});

describe("lecture tolérante et validation", () => {
  it("scénarios : entrées illisibles écartées, plafonds appliqués, scénario actif inexistant remis à null", () => {
    const parsed = parseScenarios({ actif: "fantome", scenarios: [{ id: "a", nom: "A", lignes: [{ id: "1", type: "G50", montant: 5, date: "2026-12-01", mode: "CHEQUE", certitude: "CERTAIN" }, { id: "2", type: "BIDON" }, null] }, { nom: "sans id" }, 4] });
    expect(parsed.actif).toBeNull();
    expect(parsed.scenarios).toHaveLength(1);
    expect(parsed.scenarios[0]?.lignes).toHaveLength(1);
    expect(parseScenarios("x")).toEqual({ actif: null, scenarios: [] });
    const lines = Array.from({ length: 80 }, (_, index) => ({ id: `l${index}`, type: "AUTRE", montant: 1, date: "2026-12-01", mode: "VIREMENT", certitude: "ESTIME" }));
    expect(parseScenarios({ scenarios: [{ id: "a", nom: "A", lignes: lines }] }).scenarios[0]?.lignes).toHaveLength(MAX_LINES_PER_SCENARIO);
  });
  it("réglages : 15 jours et aucun encaissement par défaut ; valeurs inconnues ramenées au défaut", () => {
    expect(parseSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings({ coussinJours: 7, encaissementsAttendus: true })).toEqual({ coussinJours: 7, encaissementsAttendus: true });
    expect(parseSettings({ coussinJours: 12, encaissementsAttendus: "oui" })).toEqual(DEFAULT_SETTINGS);
    expect(treasurySettingsSchema.safeParse({ coussinJours: 12, encaissementsAttendus: false }).success).toBe(false);
  });
  it("ligne de simulation : montant strictement positif, date et libellé obligatoires", () => {
    const valid = { scenarioId: "s1", type: "G50", libelle: "G50", periode: "2026-10", montant: 10, date: "2026-12-01", mode: "CHEQUE", certitude: "ESTIME" };
    expect(simLineSchema.safeParse(valid).success).toBe(true);
    expect(simLineSchema.safeParse({ ...valid, montant: 0 }).success).toBe(false);
    expect(simLineSchema.safeParse({ ...valid, montant: -5 }).success).toBe(false);
    expect(simLineSchema.safeParse({ ...valid, libelle: "  " }).success).toBe(false);
    expect(simLineSchema.safeParse({ ...valid, date: "01/12/2026" }).success).toBe(false);
    expect(simLineSchema.safeParse({ ...valid, periode: "2026-13" }).success).toBe(false);
  });
});
