import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser, ProfileKey } from "@/features/access/types";
import { resolveAccess } from "@/features/access/services/access-rules";
import { writeWorkbook } from "@/lib/spreadsheet";
import { OPS, statement } from "./helpers/agb-statement";

interface Row {
  value: unknown;
  updatedAt: Date;
}
const settings = new Map<string, Row>();
const lines = new Map<string, Record<string, unknown>>();
const hooks = { upserts: 0 };
let clock = 1;

vi.mock("@/lib/db", () => ({
  db: {
    setting: {
      findUnique: async ({ where }: { where: { key: string } }) => {
        const row = settings.get(where.key);
        return row ? { key: where.key, value: structuredClone(row.value), updatedAt: row.updatedAt } : null;
      },
      updateMany: async ({ where, data }: { where: { key: string; updatedAt: Date }; data: { value: unknown } }) => {
        const row = settings.get(where.key);
        if (!row || row.updatedAt.getTime() !== where.updatedAt.getTime()) return { count: 0 };
        settings.set(where.key, { value: structuredClone(data.value), updatedAt: new Date(++clock) });
        return { count: 1 };
      },
      createMany: async ({ data }: { data: Array<{ key: string; value: unknown }> }) => {
        let count = 0;
        for (const item of data) {
          if (settings.has(item.key)) continue;
          settings.set(item.key, { value: structuredClone(item.value), updatedAt: new Date(++clock) });
          count += 1;
        }
        return { count };
      },
    },
    bankStatementLine: {
      findMany: async ({ where }: { where: { legacyId?: { in: string[] } } }) => (where.legacyId ? where.legacyId.in.filter((key) => lines.has(key)).map((key) => ({ legacyId: key, status: lines.get(key)?.status })) : []),
      upsert: async ({ where, create, update }: { where: { legacyId: string }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        hooks.upserts += 1;
        lines.set(where.legacyId, lines.has(where.legacyId) ? { ...lines.get(where.legacyId), ...update } : create);
      },
    },
    transferBatch: { findMany: async () => [] },
    hrEntry: { findMany: async () => [] },
    invoice: { findMany: async () => [] },
  },
}));

const logged: string[] = [];
vi.mock("@/features/journal/services/journal-service", () => ({
  logAction: async (_actor: unknown, action: string) => {
    logged.push(action);
  },
}));

const { importStatementFromTreasury, NO_STATEMENT_ACCESS_MESSAGE } = await import("@/features/treasury/services/treasury-statement-upload");
const { parseSolde } = await import("@/features/treasury/lib/store-parse");

function actor(profile: ProfileKey, overrides: Array<{ module: "RELEVE"; level: "NONE" | "VIEW" | "EDIT" }> = []): AuthUser {
  return { id: `u-${profile}`, email: "x@alloassistance.dz", name: profile, profile, isAdmin: profile === "ADMINISTRATEUR" || profile === "DIRECTION", access: resolveAccess(profile, overrides) };
}

const fileOf = (rows: ReturnType<typeof statement>, name = "report_92.xls"): { name: string; bytes: Uint8Array } => ({ name, bytes: writeWorkbook([{ name: "Feuil1", rows: rows as never }]) });
const comptable = actor("COMPTABLE");

beforeEach(() => {
  settings.clear();
  lines.clear();
  logged.length = 0;
  hooks.upserts = 0;
});

describe("import d'un relevé AGB depuis la Trésorerie (flux du relevé bancaire réutilisé)", () => {
  it("premier import : solde lu et enregistré, lignes nouvelles comptées, import journalisé", async () => {
    const result = await importStatementFromTreasury(comptable, fileOf(statement(OPS)));
    if (!result.success) throw new Error(result.error);
    expect(result.data.balance).toMatchObject({ status: "enregistre", amount: 10_844_167.64, date: "2026-11-22" });
    expect(result.data.linesTotal).toBe(OPS.length);
    expect(result.data.alreadyKnown).toBe(0);
    expect(result.data.bankFees).toBe(1);
    expect(result.data.newLines).toBe(OPS.length - 1 - result.data.grouped);
    expect(parseSolde(settings.get("tresorerie:solde")?.value).current?.balance).toBe(10_844_167.64);
    expect(logged).toContain("Import du relevé bancaire");
    expect(logged).toContain("Solde de trésorerie mis à jour");
  });

  it("relevé sans aucune ligne nouvelle (tout déjà connu) : le solde est quand même enregistré", async () => {
    const file = fileOf(statement(OPS));
    await importStatementFromTreasury(comptable, file);
    settings.clear();
    logged.length = 0;
    const upsertsBefore = hooks.upserts;
    const again = await importStatementFromTreasury(comptable, file);
    if (!again.success) throw new Error(again.error);
    expect(again.data.newLines).toBe(0);
    expect(again.data.alreadyKnown).toBe(OPS.length - 1 - again.data.grouped);
    expect(again.data.grouped).toBe(1);
    expect(hooks.upserts).toBe(upsertsBefore);
    expect(again.data.balance).toMatchObject({ status: "enregistre", amount: 10_844_167.64 });
    expect(parseSolde(settings.get("tresorerie:solde")?.value).current?.balance).toBe(10_844_167.64);
    expect(logged).toContain("Solde de trésorerie mis à jour");
  });

  it("compte différent ou relevé incohérent : refus en français, ancien solde conservé, import des lignes inchangé", async () => {
    await importStatementFromTreasury(comptable, fileOf(statement(OPS)));
    const other = await importStatementFromTreasury(comptable, fileOf(statement(OPS, { account: "2737851999" }), "autre.xls"));
    if (!other.success) throw new Error(other.error);
    expect(other.data.balance).toMatchObject({ status: "refuse", reason: "compte" });
    expect(other.data.balance?.message).toMatch(/compte/i);
    const broken = await importStatementFromTreasury(
      comptable,
      fileOf(
        statement(OPS, {
          tamper: (rows) => {
            const footer = rows.find((row) => row[0] === "Solde FIN AU");
            if (footer) footer[4] = "1.0000";
          },
        }),
        "casse.xls",
      ),
    );
    if (!broken.success) throw new Error(broken.error);
    expect(broken.data.balance).toMatchObject({ status: "refuse", reason: "incoherent" });
    const state = parseSolde(settings.get("tresorerie:solde")?.value);
    expect(state.current?.balance).toBe(10_844_167.64);
    expect(state.rejection?.reason).toBe("incoherent");
  });

  it("fichier sans « Solde FIN AU » : rien n'est écrit pour le solde, l'import des lignes continue", async () => {
    const rows = statement(OPS).filter((row) => row[0] !== "Solde FIN AU");
    const result = await importStatementFromTreasury(comptable, fileOf(rows as ReturnType<typeof statement>, "sans_pied.xls"));
    if (!result.success) throw new Error(result.error);
    expect(result.data.balance).toMatchObject({ status: "ignore", reason: "structure" });
    expect(settings.has("tresorerie:solde")).toBe(false);
    expect(result.data.newLines).toBeGreaterThan(0);
  });

  it("relevé plus ancien que le solde enregistré : signalé, solde non remplacé", async () => {
    await importStatementFromTreasury(comptable, fileOf(statement(OPS)));
    const older = statement(OPS);
    const footer = older.find((row) => row[0] === "Solde FIN AU");
    if (footer) footer[2] = "2026/11/10";
    const result = await importStatementFromTreasury(comptable, fileOf(older, "ancien.xls"));
    if (!result.success) throw new Error(result.error);
    expect(result.data.balance?.status).toBe("ignore");
    expect(result.data.balance?.reason).toBe("ancien");
    expect(parseSolde(settings.get("tresorerie:solde")?.value).current?.balanceDate).toBe("2026-11-22");
  });

  it("mêmes droits que le relevé : accès Trésorerie sans modification du Relevé bancaire = message clair, rien d'écrit", async () => {
    const result = await importStatementFromTreasury(actor("COMPTABLE", [{ module: "RELEVE", level: "VIEW" }]), fileOf(statement(OPS)));
    expect(result).toMatchObject({ success: false, code: "FORBIDDEN", error: NO_STATEMENT_ACCESS_MESSAGE });
    expect(NO_STATEMENT_ACCESS_MESSAGE).toContain("Relevé bancaire");
    expect(lines.size).toBe(0);
    expect(settings.size).toBe(0);
  });

  it("sans accès Trésorerie (même avec le droit Relevé) : refusé", async () => {
    expect(await importStatementFromTreasury(actor("EQUIPE_FACTURATION"), fileOf(statement(OPS)))).toMatchObject({ success: false, code: "FORBIDDEN" });
    expect(lines.size).toBe(0);
  });

  it("fichier illisible : erreur du flux existant, rien n'est écrit", async () => {
    const result = await importStatementFromTreasury(comptable, { name: "x.xls", bytes: new Uint8Array([1, 2, 3]) });
    expect(result.success).toBe(false);
    expect(settings.size).toBe(0);
  });
});
