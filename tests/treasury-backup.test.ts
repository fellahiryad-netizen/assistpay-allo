import { describe, expect, it, vi } from "vitest";
import { resolveAccess } from "@/features/access/services/access-rules";
import type { AuthUser, ProfileKey } from "@/features/access/types";

const settings = [
  { key: "mla:params:2026", value: { a: 1 } },
  { key: "tresorerie:solde", value: { secret: "120850558.05" } },
  { key: "tresorerie:scenarios", value: { secret: "G50" } },
  { key: "login:x", value: 1 },
];

type Where = { AND?: Array<{ NOT: { key: { startsWith: string } } }> };
vi.mock("@/lib/db", () => {
  const none = { findMany: async () => [] };
  return {
    db: {
      invoice: none, bankStatementLine: none, paymentRequest: none, issuedInvoice: none, caarProduction: none, transferBatch: none, providerRib: none, hrEntry: none,
      setting: { findMany: async ({ where }: { where: Where }) => settings.filter((row) => (where.AND ?? []).every((cond) => !row.key.startsWith(cond.NOT.key.startsWith))) },
    },
  };
});
vi.mock("@/features/journal/services/journal-service", () => ({ logAction: async () => undefined }));

const { buildBackup } = await import("@/features/pilot/services/backup-service");

function user(profile: ProfileKey): AuthUser {
  return { id: "u", email: "x", name: "T", profile, isAdmin: profile === "ADMINISTRATEUR" || profile === "DIRECTION", access: resolveAccess(profile, []) };
}

describe("sauvegarde et clés de trésorerie", () => {
  it("l'équipe facturation (accès PILOT) n'obtient aucune clé tresorerie: ni en JSON ni en xlsx", async () => {
    const json = await buildBackup(user("EQUIPE_FACTURATION"), "json");
    expect(json.success).toBe(true);
    if (json.success) {
      const text = new TextDecoder().decode(json.data.bytes);
      expect(text).not.toContain("tresorerie:");
      expect(text).not.toContain("120850558");
      expect(text).toContain("mla:params:2026");
    }
    const xlsx = await buildBackup(user("EQUIPE_FACTURATION"), "xlsx");
    expect(xlsx.success).toBe(true);
    if (xlsx.success) {
      const { readWorkbook } = await import("@/lib/spreadsheet");
      const cells = readWorkbook(xlsx.data.bytes).flatMap((sheet) => sheet.rows.flat()).map(String).join("|");
      expect(cells).not.toContain("tresorerie:");
      expect(cells).toContain("mla:params:2026");
    }
  });
  it("les profils avec accès trésorerie retrouvent les clés", async () => {
    for (const profile of ["ADMINISTRATEUR", "DIRECTION", "COMPTABLE"] as const) {
      const json = await buildBackup(user(profile), "json");
      expect(json.success).toBe(true);
      if (json.success) {
        const text = new TextDecoder().decode(json.data.bytes);
        expect(text).toContain("tresorerie:solde");
        expect(text).not.toContain("login:x");
      }
    }
  });
});
