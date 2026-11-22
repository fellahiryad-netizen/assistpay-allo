import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser, ProfileKey } from "@/features/access/types";
import { resolveAccess } from "@/features/access/services/access-rules";
import { OPS, statement } from "./helpers/agb-statement";

interface Row {
  value: unknown;
  updatedAt: Date;
}

/** Base en mémoire : table `Setting` avec écriture conditionnelle sur `updatedAt`, plus quelques lignes RH. */
const store = new Map<string, Row>();
const hooks = { failWrites: false, interleave: false };
let clock = 1;
const hrRows: Array<Record<string, unknown>> = [];

vi.mock("@/lib/db", () => ({
  db: {
    setting: {
      findUnique: async ({ where }: { where: { key: string } }) => {
        const row = store.get(where.key);
        const copy = row ? { key: where.key, value: structuredClone(row.value), updatedAt: row.updatedAt } : null;
        if (hooks.interleave) await new Promise((resolve) => setTimeout(resolve, 0));
        return copy;
      },
      updateMany: async ({ where, data }: { where: { key: string; updatedAt: Date }; data: { value: unknown } }) => {
        if (hooks.failWrites) return { count: 0 };
        const row = store.get(where.key);
        if (!row || row.updatedAt.getTime() !== where.updatedAt.getTime()) return { count: 0 };
        store.set(where.key, { value: structuredClone(data.value), updatedAt: new Date(++clock) });
        return { count: 1 };
      },
      createMany: async ({ data }: { data: Array<{ key: string; value: unknown }> }) => {
        let count = 0;
        for (const item of data) {
          if (store.has(item.key)) continue;
          store.set(item.key, { value: structuredClone(item.value), updatedAt: new Date(++clock) });
          count += 1;
        }
        return { count };
      },
    },
    hrEntry: { findMany: async () => hrRows },
    bankStatementLine: { findMany: async () => [], aggregate: async () => ({ _min: { date: null } }), groupBy: async () => [] },
    invoice: { findMany: async () => [] },
    transferBatch: { findMany: async () => [] },
    paymentRequest: { findMany: async () => [] },
  },
}));

const logged: string[] = [];
vi.mock("@/features/journal/services/journal-service", () => ({
  logAction: async (_actor: unknown, action: string) => {
    logged.push(action);
  },
}));

const { activateScenarioEntry, addSimulationLine, createScenarioEntry, decideSimulationLine } = await import("@/features/treasury/services/treasury-scenarios");
const { recordStatementBalance } = await import("@/features/treasury/services/treasury-import");
const { getTreasuryView, saveManualBalance, saveTreasurySettings } = await import("@/features/treasury/services/treasury-service");
const { parseActive, parseScenarios, parseSolde } = await import("@/features/treasury/lib/store-parse");

function actor(profile: ProfileKey): AuthUser {
  return { id: `u-${profile}`, email: "x@alloassistance.dz", name: profile, profile, isAdmin: profile === "ADMINISTRATEUR" || profile === "DIRECTION", access: resolveAccess(profile, []) };
}

beforeEach(() => {
  store.clear();
  logged.length = 0;
  hrRows.length = 0;
  hooks.failWrites = false;
  hooks.interleave = false;
});

describe("concurrence des scénarios (écriture conditionnelle sur updatedAt)", () => {
  it("deux créations simultanées : aucune n'est perdue", async () => {
    hooks.interleave = true;
    const [first, second] = await Promise.all([createScenarioEntry(actor("COMPTABLE"), { nom: "Fin novembre" }), createScenarioEntry(actor("COMPTABLE"), { nom: "Cas prudent" })]);
    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    const names = parseScenarios(store.get("tresorerie:scenarios")?.value).scenarios.map((scenario) => scenario.nom).sort();
    expect(names).toEqual(["Cas prudent", "Fin novembre"]);
  });

  it("dix modifications simultanées : toutes appliquées après nouvelles tentatives, ou conflit explicite, jamais d'écrasement silencieux", async () => {
    hooks.interleave = true;
    const results = await Promise.all(Array.from({ length: 10 }, (_, index) => createScenarioEntry(actor("COMPTABLE"), { nom: `S${index}` })));
    const done = results.filter((result) => result.success).length;
    const saved = parseScenarios(store.get("tresorerie:scenarios")?.value).scenarios.length;
    expect(saved).toBe(done);
    for (const result of results) if (!result.success) expect(result.code).toBe("CONFLICT");
    expect(done).toBeGreaterThanOrEqual(5);
  });

  it("écriture toujours refusée : conflit après 5 tentatives, rien n'est enregistré", async () => {
    await createScenarioEntry(actor("COMPTABLE"), { nom: "Base" });
    hooks.failWrites = true;
    const result = await createScenarioEntry(actor("COMPTABLE"), { nom: "Perdu" });
    expect(result).toMatchObject({ success: false, code: "CONFLICT" });
    expect(parseScenarios(store.get("tresorerie:scenarios")?.value).scenarios.map((scenario) => scenario.nom)).toEqual(["Base"]);
  });

  it("un profil sans accès ne touche pas à la base ; la comptable crée et le journal est écrit", async () => {
    const refused = await createScenarioEntry(actor("RH"), { nom: "Interdit" });
    expect(refused).toMatchObject({ success: false, code: "FORBIDDEN" });
    expect(store.size).toBe(0);
    const created = await createScenarioEntry(actor("COMPTABLE"), { nom: "Autorisé" });
    expect(created.success).toBe(true);
    expect(logged).toEqual(["Scénario de trésorerie créé"]);
  });
});

describe("solde importé et ligne de simulation (base simulée)", () => {
  const importer = actor("COMPTABLE");

  it("enregistre le solde du relevé, puis refuse un compte différent sans toucher au solde", async () => {
    const stored = await recordStatementBalance(importer, statement(OPS), "report_92.xls");
    expect(stored).toMatchObject({ success: true, data: { status: "enregistre" } });
    expect(parseSolde(store.get("tresorerie:solde")?.value).current?.balance).toBe(10_844_167.64);
    const wrong = await recordStatementBalance(importer, statement(OPS, { account: "1111111111" }), "autre.xls");
    expect(wrong).toMatchObject({ success: true, data: { status: "refuse" } });
    const state = parseSolde(store.get("tresorerie:solde")?.value);
    expect(state.current?.balance).toBe(10_844_167.64);
    expect(state.rejection?.reason).toBe("compte");
  });

  it("un fichier sans la structure AGB n'écrit rien et ne bloque rien", async () => {
    const result = await recordStatementBalance(importer, [["Date", "Libellé", "Débit", "Crédit"]], "quelconque.xlsx");
    expect(result).toMatchObject({ success: true, data: { status: "ignore" } });
    expect(store.size).toBe(0);
  });

  it("un relevé incohérent est refusé (statut tracé) et le solde précédent reste", async () => {
    await recordStatementBalance(importer, statement(OPS), "ok.xls");
    const broken = statement(OPS, {
      tamper: (rows) => {
        const footer = rows.find((row) => row[0] === "Solde FIN AU");
        if (footer) footer[4] = "1.0000";
      },
    });
    const outcome = await recordStatementBalance(importer, broken, "casse.xls");
    expect(outcome).toMatchObject({ success: true, data: { status: "refuse" } });
    const state = parseSolde(store.get("tresorerie:solde")?.value);
    expect(state.current?.balance).toBe(10_844_167.64);
    expect(state.rejection?.reason).toBe("incoherent");
  });

  it("ajoute une ligne simulée et signale le G50 d'octobre déjà présent dans le RH ; la décision ne supprime rien", async () => {
    await recordStatementBalance(importer, statement(OPS), "report_92.xls");
    hrRows.push({ id: "hr-g50", nature: "G50", mois: "2026-10", annee: 2026, date: new Date("2026-11-19T00:00:00Z"), montant: { toNumber: () => 22_752_053 }, libelle: "G50 octobre 2026", beneficiaire: "Receveur des impôts Chéraga" });
    const created = await createScenarioEntry(importer, { nom: "Fin novembre" });
    if (!created.success) throw new Error(created.error);
    await activateScenarioEntry(importer, { scenarioId: created.data.id });
    const line = { scenarioId: created.data.id, type: "G50" as const, libelle: "G50 octobre", periode: "2026-10", montant: 22_752_053, date: "2026-11-30", mode: "CHEQUE" as const, certitude: "ESTIME" as const };
    const added = await addSimulationLine(importer, line);
    expect(added.success).toBe(true);
    if (!added.success) return;
    expect(added.data.warnings[0]).toContain("semble déjà enregistré dans le RH");
    const before = parseScenarios(store.get("tresorerie:scenarios")?.value);
    expect(before.actif).toBeNull();
    expect(parseActive(store.get(`tresorerie:actif:${importer.id}`)?.value).scenarioId).toBe(created.data.id);
    expect(before.scenarios[0]?.lignes).toHaveLength(1);
    const decided = await decideSimulationLine(importer, { scenarioId: created.data.id, lineId: added.data.lineId, decision: "ignorer" });
    expect(decided.success).toBe(true);
    const after = parseScenarios(store.get("tresorerie:scenarios")?.value);
    expect(after.scenarios[0]?.lignes[0]?.decision).toBe("ignorer");
    expect(after.scenarios[0]?.lignes).toHaveLength(1);
    // La simulation n'écrit que dans les réglages : jamais dans les écritures RH.
    expect(hrRows).toHaveLength(1);
  });

  it("refuse une date antérieure au solde, un montant énorme non confirmé, et une ligne sans solde", async () => {
    const created = await createScenarioEntry(importer, { nom: "A" });
    if (!created.success) throw new Error(created.error);
    const line = { scenarioId: created.data.id, type: "CNAS" as const, libelle: "CNAS", periode: "", montant: 1000, date: "2026-12-01", mode: "VIREMENT" as const, certitude: "CERTAIN" as const };
    expect(await addSimulationLine(importer, line)).toMatchObject({ success: false, code: "VALIDATION" });
    await recordStatementBalance(importer, statement(OPS), "report_92.xls");
    expect(await addSimulationLine(importer, { ...line, date: "2026-11-01" })).toMatchObject({ success: false, code: "VALIDATION" });
    expect(await addSimulationLine(importer, { ...line, montant: 150_000_000 })).toMatchObject({ success: false, code: "VALIDATION" });
    expect((await addSimulationLine(importer, { ...line, montant: 150_000_000, confirmer: true })).success).toBe(true);
  });

  it("réglages et solde manuel : réservés à l'Administrateur et à la Direction ; manuel refusé si un relevé valide existe", async () => {
    expect(await saveTreasurySettings(actor("COMPTABLE"), { minimumMode: "jours", minimumMontant: 20_000_000, coussinJours: 30, encaissementsAttendus: true })).toMatchObject({ success: false, code: "FORBIDDEN" });
    expect((await saveTreasurySettings(actor("DIRECTION"), { minimumMode: "jours", minimumMontant: 20_000_000, coussinJours: 30, encaissementsAttendus: false })).success).toBe(true);
    expect(store.get("tresorerie:reglages")?.value).toEqual({ minimumMode: "jours", minimumMontant: 20_000_000, coussinJours: 30, encaissementsAttendus: false });
    const manual = { balance: 1000, date: "2026-11-21", source: "relevé AGB du 21/11/2026" };
    expect((await saveManualBalance(actor("ADMINISTRATEUR"), manual)).success).toBe(true);
    expect(parseSolde(store.get("tresorerie:solde")?.value).manual?.balance).toBe(1000);
    await recordStatementBalance(importer, statement(OPS), "report_92.xls");
    expect(parseSolde(store.get("tresorerie:solde")?.value).manual).toBeNull();
    expect(await saveManualBalance(actor("ADMINISTRATEUR"), { ...manual, date: "2026-11-22" })).toMatchObject({ success: false, code: "CONFLICT" });
  });
});

describe("scénario actif propre à chaque utilisateur, consultations journalisées, doublons", () => {
  const comptable = actor("COMPTABLE");
  const direction = actor("DIRECTION");
  const line = (scenarioId: string) => ({ scenarioId, type: "G50" as const, libelle: "G50 octobre", periode: "2026-10", montant: 22_752_053, date: "2026-11-30", mode: "CHEQUE" as const, certitude: "ESTIME" as const });

  async function prepare(): Promise<string> {
    await recordStatementBalance(comptable, statement(OPS), "report_92.xls");
    hrRows.push({ id: "hr-g50", nature: "G50", mois: "2026-10", annee: 2026, date: new Date("2026-11-19T00:00:00Z"), montant: { toNumber: () => 22_752_053 }, libelle: "G50 octobre 2026", beneficiaire: "Receveur", mode: "CHEQUE", cheque: "", sens: "PAIEMENT" });
    const created = await createScenarioEntry(comptable, { nom: "Fin novembre" });
    if (!created.success) throw new Error(created.error);
    await addSimulationLine(comptable, line(created.data.id));
    await activateScenarioEntry(comptable, { scenarioId: created.data.id });
    return created.data.id;
  }

  it("la Direction ne voit jamais le scénario activé par la comptable ; chacun voit le sien", async () => {
    const id = await prepare();
    const seenByComptable = await getTreasuryView(comptable, { demandes: false });
    const seenByDirection = await getTreasuryView(direction, { demandes: false });
    if (!seenByComptable.success || !seenByDirection.success) throw new Error("lecture refusée");
    expect(seenByComptable.data.active?.id).toBe(id);
    expect(seenByDirection.data.active).toBeNull();
    expect(seenByDirection.data.computation?.simulationTotal).toBe(0);
    expect(seenByComptable.data.computation?.simulationTotal).toBe(22_752_053);
    await activateScenarioEntry(direction, { scenarioId: id });
    expect(parseActive(store.get(`tresorerie:actif:${direction.id}`)?.value).scenarioId).toBe(id);
    await activateScenarioEntry(comptable, { scenarioId: null });
    const after = await getTreasuryView(direction, { demandes: false });
    if (!after.success) throw new Error("lecture refusée");
    expect(after.data.active?.id).toBe(id);
  });

  it("l'ancien champ partagé `actif` n'est jamais appliqué à personne", async () => {
    const id = await prepare();
    const row = store.get("tresorerie:scenarios");
    if (!row) throw new Error("absent");
    store.set("tresorerie:scenarios", { ...row, value: { ...(row.value as object), actif: id } });
    store.delete(`tresorerie:actif:${comptable.id}`);
    const view = await getTreasuryView(direction, { demandes: false });
    if (!view.success) throw new Error("lecture refusée");
    expect(view.data.active).toBeNull();
  });

  it("une ligne signalée comme doublon possible est comptée et annoncée avec son impact, jusqu'à ce qu'elle soit écartée", async () => {
    const id = await prepare();
    const view = await getTreasuryView(comptable, { demandes: false });
    if (!view.success || !view.data.computation) throw new Error("lecture refusée");
    expect(view.data.duplicates).toMatchObject({ count: 1, total: 22_752_053 });
    expect(view.data.duplicates?.balanceAfterWithout).toBe(Math.round((view.data.computation.balanceAfter + 22_752_053) * 100) / 100);
    const lineId = view.data.active?.lignes[0]?.id ?? "";
    await decideSimulationLine(comptable, { scenarioId: id, lineId, decision: "ignorer" });
    const after = await getTreasuryView(comptable, { demandes: false });
    if (!after.success) throw new Error("lecture refusée");
    expect(after.data.duplicates).toBeNull();
  });

  it("chaque consultation écrit une ligne : page, impression ; l'export écrit la sienne seule", async () => {
    await prepare();
    logged.length = 0;
    await getTreasuryView(comptable, { demandes: false });
    await getTreasuryView(comptable, { demandes: false }, "impression");
    await getTreasuryView(comptable, { demandes: false }, "export");
    expect(logged).toEqual(["Consultation de la trésorerie", "Impression de la trésorerie"]);
  });

  it("la fonction de lecture des sources refuse un profil sans accès", async () => {
    const { loadDuplicateSources } = await import("@/features/treasury/services/treasury-sources");
    expect(await loadDuplicateSources(actor("EQUIPE_FACTURATION"))).toMatchObject({ success: false, code: "FORBIDDEN" });
  });
});

describe("exports Excel et PDF de présentation", () => {
  const comptable = actor("COMPTABLE");
  async function prepare(withSimulation: boolean): Promise<void> {
    await recordStatementBalance(comptable, statement(OPS), "report_92.xls");
    if (!withSimulation) return;
    const created = await createScenarioEntry(comptable, { nom: "Fin novembre" });
    if (!created.success) throw new Error(created.error);
    await addSimulationLine(comptable, { scenarioId: created.data.id, type: "CNAS", libelle: "CNAS octobre", periode: "2026-10", montant: 4_800_000, date: "2026-11-30", mode: "VIREMENT", certitude: "CERTAIN" });
    await activateScenarioEntry(comptable, { scenarioId: created.data.id });
  }
  const pageCount = (bytes: Uint8Array): number => (Buffer.from(bytes).toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;

  it("le PDF est un vrai PDF de 8 pages sans simulation, 9 avec, et journalisé", async () => {
    const { exportTreasuryPdf } = await import("@/features/treasury/services/treasury-pdf");
    await prepare(false);
    logged.length = 0;
    const plain = await exportTreasuryPdf(comptable, { demandes: false });
    if (!plain.success) throw new Error(plain.error);
    expect(Buffer.from(plain.data.bytes.slice(0, 5)).toString("latin1")).toBe("%PDF-");
    expect(plain.data.pages).toBe(8);
    expect(pageCount(plain.data.bytes)).toBe(8);
    expect(plain.data.name).toMatch(/^tresorerie_\d{4}-\d{2}-\d{2}\.pdf$/);
    expect(logged).toEqual(["Export PDF de la trésorerie"]);
    await prepare(true);
    const simulated = await exportTreasuryPdf(comptable, { demandes: false });
    if (!simulated.success) throw new Error(simulated.error);
    expect(simulated.data.pages).toBe(9);
    expect(pageCount(simulated.data.bytes)).toBe(9);
  });

  it("le PDF est refusé sans droit Trésorerie et sans solde", async () => {
    const { exportTreasuryPdf } = await import("@/features/treasury/services/treasury-pdf");
    expect(await exportTreasuryPdf(actor("EQUIPE_FACTURATION"), { demandes: false })).toMatchObject({ success: false, code: "FORBIDDEN" });
    expect(await exportTreasuryPdf(comptable, { demandes: false })).toMatchObject({ success: false, code: "NOT_FOUND" });
  });

  it("le PDF de la Direction ne reprend pas le scénario de la comptable", async () => {
    const { exportTreasuryPdf } = await import("@/features/treasury/services/treasury-pdf");
    await prepare(true);
    const direction = await exportTreasuryPdf(actor("DIRECTION"), { demandes: false });
    if (!direction.success) throw new Error(direction.error);
    expect(direction.data.pages).toBe(8);
  });

  it("l'Excel contient les onglets attendus, la page Simulation seulement si un scénario est actif, et des dates réelles", async () => {
    const { exportTreasury } = await import("@/features/treasury/services/treasury-export");
    const { readWorkbook } = await import("@/lib/spreadsheet");
    await prepare(false);
    const plain = await exportTreasury(comptable, { demandes: false });
    if (!plain.success) throw new Error(plain.error);
    expect(readWorkbook(plain.data.bytes).map((sheet) => sheet.name)).toEqual(["Synthèse", "Échéancier", "Chronologie", "Chèques en circulation", "Hypothèses et contrôles"]);
    await prepare(true);
    const simulated = await exportTreasury(comptable, { demandes: false });
    if (!simulated.success) throw new Error(simulated.error);
    const sheets = readWorkbook(simulated.data.bytes);
    expect(sheets.map((sheet) => sheet.name)).toContain("Simulation");
    expect(String(sheets[0]?.rows[1]?.[0])).toContain("MODE SIMULATION");
    const forbidden = await exportTreasury(actor("EQUIPE_FACTURATION"), { demandes: false });
    expect(forbidden).toMatchObject({ success: false, code: "FORBIDDEN" });
  });
});
