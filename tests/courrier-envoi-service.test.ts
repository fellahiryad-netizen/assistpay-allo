import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccessLevelKey, AuthUser, ProfileKey } from "@/features/access/types";
import { resolveAccess } from "@/features/access/services/access-rules";

interface Row {
  value: unknown;
  updatedAt: Date;
}

/** Base en mémoire : table `Setting` avec écriture conditionnelle sur `updatedAt`. */
const store = new Map<string, Row>();
const hooks = { failWrites: false, interleave: false, throwOnRead: false };
let clock = 1;

vi.mock("@/lib/db", () => ({
  db: {
    setting: {
      findUnique: async ({ where }: { where: { key: string } }) => {
        if (hooks.throwOnRead) throw new Error("base indisponible");
        const row = store.get(where.key);
        const copy = row ? { key: where.key, value: structuredClone(row.value), updatedAt: row.updatedAt } : null;
        if (hooks.interleave) await new Promise((resolve) => setTimeout(resolve, 0));
        return copy;
      },
      findMany: async ({ where }: { where: { key: { startsWith: string } } }) =>
        [...store.entries()].filter(([key]) => key.startsWith(where.key.startsWith)).map(([key, row]) => ({ key, value: structuredClone(row.value), updatedAt: row.updatedAt })),
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
          if (hooks.failWrites || store.has(item.key)) continue;
          store.set(item.key, { value: structuredClone(item.value), updatedAt: new Date(++clock) });
          count += 1;
        }
        return { count };
      },
    },
  },
}));

const logged: Array<{ action: string; objet: string; trace?: { entity: string; entityId: string; avant: Record<string, unknown>; apres: Record<string, unknown> } }> = [];
vi.mock("@/features/journal/services/journal-service", () => ({
  logAction: async (_actor: unknown, action: string, objet: string, _admin?: boolean, trace?: (typeof logged)[number]["trace"]) => {
    logged.push({ action, objet, trace });
  },
}));

const { cancelEnvoi, createEnvoi, exportEnvois, getEnvoi, listEnvois, updateEnvoi } = await import("@/features/courrier/services/envoi-service");
const { envoiCreateSchema } = await import("@/features/courrier/schemas");
const { ENVOI_KEY_PREFIX } = await import("@/features/courrier/types");

function actor(profile: ProfileKey, part?: AccessLevelKey, extra: Array<{ module: string; level: AccessLevelKey }> = []): AuthUser {
  const grants = [...(part ? [{ module: "PART", level: part }] : []), ...extra];
  return { id: `u-${profile}`, email: "x@alloassistance.dz", name: profile, profile, isAdmin: false, access: resolveAccess(profile, grants as never) };
}

const writer = actor("CHARGE_FACTURATION", "EDIT", [{ module: "A_EXPORT", level: "EDIT" }]);
const reader = actor("CHARGE_FACTURATION", "VIEW", [{ module: "A_EXPORT", level: "NONE" }]);
const blocked = actor("CHARGE_FACTURATION", "NONE");
const input = (extra: Record<string, unknown> = {}) =>
  envoiCreateSchema.parse({ date: "2026-11-24", ramasseur: "Hichem", remarque: "", lignes: [{ brancheId: "caar-oran-400", compagnie: "CAAR", designation: "SUCCURSALE CAAR ORAN 400", qnt: 1, destination: "ORAN", observation: "COURRIER" }], ...extra });
const year = String(new Date().getFullYear());
const key = `${ENVOI_KEY_PREFIX}${year}`;

beforeEach(() => {
  store.clear();
  logged.length = 0;
  hooks.failWrites = false;
  hooks.interleave = false;
  hooks.throwOnRead = false;
});

describe("numérotation et concurrence", () => {
  it("numéros successifs, une clé par année, journal à chaque création", async () => {
    const first = await createEnvoi(writer, input());
    const second = await createEnvoi(writer, input());
    expect(first.success && first.data.numero).toBe(`BE-${year}-001`);
    expect(second.success && second.data.numero).toBe(`BE-${year}-002`);
    expect(first.success && first.data).toMatchObject({ statut: "ETABLI", creePar: "CHARGE_FACTURATION", creeParId: "u-CHARGE_FACTURATION", ramasseLe: "" });
    expect(logged.map((l) => l.action)).toEqual(["Bordereau d'envoi établi", "Bordereau d'envoi établi"]);
    expect(logged[1]?.trace).toMatchObject({ entity: "courrier-bordereau", entityId: `BE-${year}-002`, avant: {} });
  });

  it("20 créations simultanées : 20 numéros distincts, sans trou", async () => {
    hooks.interleave = true;
    const results = await Promise.all(Array.from({ length: 20 }, () => createEnvoi(writer, input())));
    const numbers = results.flatMap((r) => (r.success ? [r.data.numero] : []));
    const failures = results.filter((r) => !r.success);
    // Chaque succès a un numéro unique ; ceux qui ont épuisé leurs tentatives reçoivent un refus clair (CONFLICT), jamais un doublon.
    expect(new Set(numbers).size).toBe(numbers.length);
    for (const f of failures) expect(f.success === false && f.code).toBe("CONFLICT");
    const sequences = numbers.map((n) => Number(n.slice(-3))).sort((a, b) => a - b);
    expect(sequences).toEqual(sequences.map((_, i) => i + 1));
    expect(numbers.length).toBeGreaterThan(0);
    const stored = store.get(key)?.value as { items: unknown[] };
    expect(stored.items).toHaveLength(numbers.length);
  });

  it("échec d'écriture répété : refus CONFLICT, rien n'est journalisé", async () => {
    hooks.failWrites = true;
    const result = await createEnvoi(writer, input());
    expect(result).toMatchObject({ success: false, code: "CONFLICT" });
    expect(logged).toHaveLength(0);
  });

  it("base indisponible : message clair, pas d'exception", async () => {
    hooks.throwOnRead = true;
    const vu = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await createEnvoi(writer, input())).toMatchObject({ success: false, code: "DATABASE" });
    vu.mockRestore();
  });
});

describe("ramassage et annulation", () => {
  it("renseigner la date de ramassage : statut ramassé, journal avant/après ; annuler : motif obligatoire, bordereau conservé", async () => {
    const created = await createEnvoi(writer, input({ date: "2026-01-02" }));
    if (!created.success) throw new Error("création");
    const numero = created.data.numero;
    const picked = await updateEnvoi(writer, { numero, ramasseLe: "2026-01-03", ramasseur: "Karim", remarque: "RAS" });
    expect(picked.success && picked.data).toMatchObject({ statut: "RAMASSE", ramasseLe: "2026-01-03", ramasseur: "Karim" });
    expect(logged.at(-1)).toMatchObject({ action: "Bordereau d'envoi modifié" });
    expect(logged.at(-1)?.trace).toMatchObject({ avant: { statut: "ETABLI", ramasseLe: "" }, apres: { statut: "RAMASSE", ramasseLe: "2026-01-03" } });
    const cancelled = await cancelEnvoi(writer, { numero, motif: "Envoi reporté" });
    expect(cancelled.success && cancelled.data.statut).toBe("ANNULE");
    expect(logged.at(-1)).toMatchObject({ action: "Bordereau d'envoi annulé" });
    expect(await updateEnvoi(writer, { numero, ramasseLe: "", ramasseur: "", remarque: "" })).toMatchObject({ success: false });
    const read = await getEnvoi(reader, numero);
    expect(read.success && read.data).toMatchObject({ statut: "ANNULE", motifAnnulation: "Envoi reporté", numero });
    const list = await listEnvois(reader);
    expect(list.success && list.data.envois).toHaveLength(1);
  });

  it("bordereau inconnu : introuvable", async () => {
    expect(await getEnvoi(reader, `BE-${year}-099`)).toMatchObject({ success: false });
    expect(await cancelEnvoi(writer, { numero: `BE-${year}-099`, motif: "Erreur" })).toMatchObject({ success: false, code: "NOT_FOUND" });
  });
});

describe("accès", () => {
  it("sans accès Partenaires : aucune lecture ni écriture ; consultation seule : lecture sans modification", async () => {
    const created = await createEnvoi(writer, input());
    if (!created.success) throw new Error("création");
    const numero = created.data.numero;
    const before = logged.length;
    for (const result of [await listEnvois(blocked), await getEnvoi(blocked, numero), await createEnvoi(blocked, input()), await exportEnvois(blocked, { q: "", du: "", au: "", ramasse: "", statut: "", compagnie: "" })]) expect(result.success).toBe(false);
    expect(await createEnvoi(reader, input())).toMatchObject({ success: false });
    expect(await updateEnvoi(reader, { numero, ramasseLe: "", ramasseur: "", remarque: "x" })).toMatchObject({ success: false });
    expect(await cancelEnvoi(reader, { numero, motif: "Erreur" })).toMatchObject({ success: false });
    const list = await listEnvois(reader);
    expect(list.success && list.data.canEdit).toBe(false);
    const full = await listEnvois(writer);
    expect(full.success && full.data.canEdit).toBe(true);
    expect(logged).toHaveLength(before);
  });

  it("export : droit d'export requis, sinon refus ; avec le droit, un fichier Excel est produit", async () => {
    await createEnvoi(writer, input());
    const filters = { q: "", du: "", au: "", ramasse: "", statut: "", compagnie: "" } as const;
    expect((await exportEnvois(reader, filters)).success).toBe(false);
    const file = await exportEnvois(writer, filters);
    expect(file.success).toBe(true);
    if (file.success) {
      expect(file.data.name).toMatch(/^historique_bordereaux_\d{4}-\d{2}-\d{2}\.xlsx$/);
      expect(file.data.bytes.length).toBeGreaterThan(200);
    }
  });
});

describe("lecture de l'historique", () => {
  it("regroupe plusieurs années, ignore les clés étrangères ou illisibles, trie du plus récent", async () => {
    const mk = (n: string) => ({ numero: n, date: "2025-03-01", creeLe: "2025-03-01T08:00:00.000Z", lignes: [{ designation: "A", qnt: 1 }] });
    store.set(`${ENVOI_KEY_PREFIX}2025`, { value: { seq: 2, items: [mk("BE-2025-001"), mk("BE-2025-002")] }, updatedAt: new Date(1) });
    store.set(`${ENVOI_KEY_PREFIX}2024`, { value: "abîmé", updatedAt: new Date(1) });
    store.set(`${ENVOI_KEY_PREFIX}test`, { value: { items: [mk("BE-2025-009")] }, updatedAt: new Date(1) });
    store.set("courrier:adresses", { value: {}, updatedAt: new Date(1) });
    await createEnvoi(writer, input());
    const list = await listEnvois(reader);
    expect(list.success && list.data.envois.map((e) => e.numero)).toEqual([`BE-${year}-001`, "BE-2025-002", "BE-2025-001"]);
  });

  it("aucune clé : liste vide", async () => {
    const list = await listEnvois(reader);
    expect(list.success && list.data.envois).toEqual([]);
  });
});
