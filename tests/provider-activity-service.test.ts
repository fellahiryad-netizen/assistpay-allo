import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "@/features/access/types";

const state = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  updates: [] as Array<{ id: string; extra: unknown }>,
  committed: [] as Array<{ id: string; extra: unknown }>,
  stale: new Set<string>(),
}));

vi.mock("@/lib/db", () => {
  const tx = {
    invoice: {
      updateMany: async ({ where, data }: { where: { id: string }; data: { extra: unknown } }) => {
        if (state.stale.has(where.id)) return { count: 0 };
        state.updates.push({ id: where.id, extra: data.extra });
        return { count: 1 };
      },
    },
  };
  return {
    db: {
      invoice: { findMany: async () => state.rows },
      // Simule la transaction : les écritures ne sont « validées » que si la fonction se termine sans erreur.
      $transaction: async (fn: (t: typeof tx) => Promise<void>) => {
        state.updates = [];
        await fn(tx);
        state.committed = state.updates;
      },
    },
  };
});
const logAction = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@/features/journal/services/journal-service", () => ({ logAction }));

import { changeProviderActivity } from "@/features/invoices/services/provider-activity-service";

const actor = { id: "u1", name: "Riad", isAdmin: true } as unknown as AuthUser;
const date = new Date("2026-11-01T10:00:00Z");
function row(id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return { id, legacyId: `l-${id}`, sens: "DEBIT", status: "EN_ATTENTE", payroll: false, annee: 2026, categorie: "Prestataire BDG", tiers: "Vitres B", nature: "", libelle: "", extra: { paiements: [{ montant: 1 }] }, updatedAt: date, ...over };
}

beforeEach(() => {
  state.rows = [row("1"), row("2"), row("3", { tiers: "Autre tiers" }), row("4", { status: "REGLE" }), row("5", { categorie: "Prestataire assistance" })];
  state.updates = [];
  state.committed = [];
  state.stale = new Set();
  logAction.mockClear();
});

describe("changeProviderActivity", () => {
  it("modifie les factures impayées du prestataire dans l'activité d'origine, en conservant extra", async () => {
    const result = await changeProviderActivity(actor, { tiers: "Vitres B", from: "bdg", to: "assistance", expected: 2 });
    expect(result).toEqual({ success: true, data: { changed: 2 } });
    expect(state.committed.map((u) => u.id)).toEqual(["1", "2"]);
    expect(state.committed[0]?.extra).toEqual({ paiements: [{ montant: 1 }], activite: "assistance" });
    expect(logAction).toHaveBeenCalledTimes(1);
  });

  it("conflit : une facture a changé, la transaction échoue et rien n'est validé", async () => {
    state.stale.add("2");
    const result = await changeProviderActivity(actor, { tiers: "Vitres B", from: "bdg", to: "assistance", expected: 2 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("CONFLICT");
      expect(result.error).toContain("rien n'a été modifié");
    }
    expect(state.committed).toEqual([]);
    expect(logAction).not.toHaveBeenCalled();
  });

  it("refuse si le nombre annoncé a changé, sans rien écrire", async () => {
    const result = await changeProviderActivity(actor, { tiers: "Vitres B", from: "bdg", to: "autre", expected: 5 });
    expect(result.success).toBe(false);
    expect(state.committed).toEqual([]);
    expect(state.updates).toEqual([]);
  });

  it("refuse sans le droit de modification", async () => {
    const reader = { id: "u2", name: "Lecteur", isAdmin: false, profile: "PARTENAIRE", access: {} } as unknown as AuthUser;
    const result = await changeProviderActivity(reader, { tiers: "Vitres B", from: "bdg", to: "autre", expected: 2 });
    expect(result.success).toBe(false);
    expect(state.updates).toEqual([]);
  });
});
