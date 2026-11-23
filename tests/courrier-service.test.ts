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

const { deleteBranchAddress, deleteEmsContactEntry, getAddressBook, saveBranchAddress, saveEmsContactEntry, saveEmsSociete } = await import("@/features/courrier/services/courrier-service");
const { branchSchema } = await import("@/features/courrier/schemas");
const { parseAddressBook } = await import("@/features/courrier/lib/address-book");
const { MAX_FICHES } = await import("@/features/courrier/types");

function actor(profile: ProfileKey, part?: AccessLevelKey): AuthUser {
  return { id: `u-${profile}`, email: "x@alloassistance.dz", name: profile, profile, isAdmin: profile === "ADMINISTRATEUR" || profile === "DIRECTION", access: resolveAccess(profile, part ? [{ module: "PART", level: part }] : []) };
}

const writer = actor("CHARGE_FACTURATION");
const reader = actor("CHARGE_FACTURATION", "VIEW");
const blocked = actor("CHARGE_FACTURATION", "NONE");

const branch = (nom: string, extra: Record<string, unknown> = {}) => branchSchema.parse({ compagnie: "CAAR", nom, contact: "", telephones: "041 00 00 00", adresse: "1 rue de la Paix, Oran", remarque: "", ...extra });
const stored = () => parseAddressBook(store.get("courrier:adresses")?.value);

beforeEach(() => {
  store.clear();
  logged.length = 0;
  hooks.failWrites = false;
  hooks.interleave = false;
  hooks.throwOnRead = false;
});

describe("lecture", () => {
  it("tant que la clé n'existe pas : liste de départ (13 + 2) et rien n'est écrit", async () => {
    const result = await getAddressBook(reader);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.branches).toHaveLength(13);
      expect(result.data.emsContacts).toHaveLength(2);
      expect(result.data.persisted).toBe(false);
      expect(result.data.canEdit).toBe(false);
    }
    expect(store.size).toBe(0);
  });

  it("accès Partenaires refusé : FORBIDDEN, la base n'est pas lue", async () => {
    hooks.throwOnRead = true;
    expect(await getAddressBook(blocked)).toMatchObject({ success: false, code: "FORBIDDEN" });
  });

  it("le profil modification voit canEdit", async () => {
    const result = await getAddressBook(writer);
    expect(result.success && result.data.canEdit).toBe(true);
  });

  it("une erreur de base devient un résultat d'échec, pas une exception", async () => {
    hooks.throwOnRead = true;
    expect(await getAddressBook(writer)).toMatchObject({ success: false, code: "DATABASE" });
  });

  it("lecture tolérante d'un réglage abîmé : fiches illisibles ignorées, identifiants dupliqués rendus uniques", async () => {
    store.set("courrier:adresses", {
      value: {
        branches: [null, 3, { id: "a", compagnie: "CAAR", nom: "Oran", telephones: 5 }, { id: "a", compagnie: "CAAT", nom: "Setif" }, { id: "b", compagnie: "XXX", nom: "Inconnue" }, { id: "c", compagnie: "CAAR", nom: " " }],
        emsContacts: "pas une liste",
      },
      updatedAt: new Date(1),
    });
    const result = await getAddressBook(reader);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.persisted).toBe(true);
      expect(result.data.branches.map((item) => item.id)).toEqual(["a", "a-2"]);
      expect(result.data.branches[0]?.telephones).toBe("");
      expect(result.data.emsContacts).toEqual([]);
      expect(result.data.emsSociete).toBe("EMS");
    }
  });
});

describe("ajout, modification, suppression", () => {
  it("le premier ajout enregistre la liste de départ avec la nouvelle fiche et écrit dans le journal", async () => {
    const result = await saveBranchAddress(writer, branch("SUCCURSALE CAAR TIZI 700"));
    expect(result.success).toBe(true);
    const book = stored();
    expect(book?.branches).toHaveLength(14);
    expect(book?.emsContacts).toHaveLength(2);
    expect(book?.branches.at(-1)).toMatchObject({ nom: "SUCCURSALE CAAR TIZI 700", compagnie: "CAAR" });
    expect(result.success && result.data.id).toMatch(/^succ-/);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ action: "Adresse courrier ajoutée", objet: "CAAR – SUCCURSALE CAAR TIZI 700" });
    expect(logged[0]?.trace).toMatchObject({ entity: "courrier-succursale", avant: {} });
  });

  it("modifier une fiche de départ la conserve avec son identifiant et journalise l'avant et l'après", async () => {
    const result = await saveBranchAddress(writer, { ...branch("SUCCURSALE CAAR ORAN 400", { telephones: "041 70 68 01" }), id: "caar-oran-400" });
    expect(result).toMatchObject({ success: true, data: { id: "caar-oran-400" } });
    const book = stored();
    expect(book?.branches).toHaveLength(13);
    expect(book?.branches.find((item) => item.id === "caar-oran-400")?.telephones).toBe("041 70 68 01");
    expect(logged[0]).toMatchObject({ action: "Adresse courrier modifiée" });
    expect(logged[0]?.trace?.avant).toMatchObject({ telephones: "041 70 68 01 /04 /05 à 07" });
    expect(logged[0]?.trace?.apres).toMatchObject({ telephones: "041 70 68 01" });
  });

  it("modifier une fiche qui n'existe plus : NOT_FOUND, rien d'écrit", async () => {
    const result = await saveBranchAddress(writer, { ...branch("Fantôme"), id: "inexistante" });
    expect(result).toMatchObject({ success: false, code: "NOT_FOUND" });
    expect(store.size).toBe(0);
    expect(logged).toHaveLength(0);
  });

  it("refuse une seconde fiche de même nom pour la même compagnie, accepte le même nom pour l'autre compagnie", async () => {
    const duplicate = await saveBranchAddress(writer, branch("succursale caar oran 400"));
    expect(duplicate).toMatchObject({ success: false, code: "CONFLICT" });
    expect(duplicate.success ? "" : duplicate.error).toContain("existe déjà");
    const other = await saveBranchAddress(writer, branch("SUCCURSALE CAAR ORAN 400", { compagnie: "CAAT" }));
    expect(other.success).toBe(true);
  });

  it("supprime une fiche, journalise, et refuse de la supprimer deux fois", async () => {
    const first = await deleteBranchAddress(writer, { id: "caat-setif" });
    expect(first).toMatchObject({ success: true, data: { id: "caat-setif" } });
    expect(stored()?.branches.some((item) => item.id === "caat-setif")).toBe(false);
    expect(logged[0]).toMatchObject({ action: "Adresse courrier supprimée", objet: "CAAT – SUCCURSALE CAAT SETIF" });
    const second = await deleteBranchAddress(writer, { id: "caat-setif" });
    expect(second).toMatchObject({ success: false, code: "NOT_FOUND" });
    expect(logged).toHaveLength(1);
  });

  it("un identifiant supprimé n'est jamais réattribué à une nouvelle fiche", async () => {
    await deleteBranchAddress(writer, { id: "caat-setif" });
    const added = await saveBranchAddress(writer, branch("SUCCURSALE CAAT SETIF", { compagnie: "CAAT" }));
    expect(added.success && added.data.id).not.toBe("caat-setif");
  });

  it("contacts EMS : ajout, modification, doublon de nom refusé, suppression, journal", async () => {
    const added = await saveEmsContactEntry(writer, { nom: "Karim", role: "RECLAMATION", telephone: "0550 00 00 00", email: "", remarque: "" });
    expect(added.success).toBe(true);
    expect(stored()?.emsContacts).toHaveLength(3);
    const again = await saveEmsContactEntry(writer, { nom: "karim", role: "RAMASSEUR", telephone: "0550 11 11 11", email: "", remarque: "" });
    expect(again).toMatchObject({ success: false, code: "CONFLICT" });
    const edited = await saveEmsContactEntry(writer, { id: "ems-hichem", nom: "Hichem", role: "RAMASSEUR", telephone: "0697 38 88 82", email: "", remarque: "" });
    expect(edited.success).toBe(true);
    expect(stored()?.emsContacts.find((item) => item.id === "ems-hichem")?.telephone).toBe("0697 38 88 82");
    const removed = await deleteEmsContactEntry(writer, { id: "ems-illoul" });
    expect(removed.success).toBe(true);
    expect(stored()?.emsContacts.map((item) => item.id)).not.toContain("ems-illoul");
    expect(logged.map((entry) => entry.action)).toEqual(["Contact courrier ajouté", "Contact courrier modifié", "Contact courrier supprimé"]);
  });

  it("nom de la société : enregistré et journalisé", async () => {
    const result = await saveEmsSociete(writer, { nom: "EMS Rapid Poste" });
    expect(result).toMatchObject({ success: true, data: { nom: "EMS Rapid Poste" } });
    expect(stored()?.emsSociete).toBe("EMS Rapid Poste");
    expect(logged[0]).toMatchObject({ action: "Société de courrier modifiée", objet: "EMS → EMS Rapid Poste" });
  });
});

describe("accès refusé", () => {
  it("consultation seule : aucune écriture, aucune ligne de journal", async () => {
    expect(await saveBranchAddress(reader, branch("Interdit"))).toMatchObject({ success: false, code: "FORBIDDEN" });
    expect(await deleteBranchAddress(reader, { id: "caat-setif" })).toMatchObject({ success: false, code: "FORBIDDEN" });
    expect(await saveEmsContactEntry(reader, { nom: "X", role: "RAMASSEUR", telephone: "0550 00 00 00", email: "", remarque: "" })).toMatchObject({ success: false, code: "FORBIDDEN" });
    expect(await deleteEmsContactEntry(reader, { id: "ems-hichem" })).toMatchObject({ success: false, code: "FORBIDDEN" });
    expect(await saveEmsSociete(reader, { nom: "Autre" })).toMatchObject({ success: false, code: "FORBIDDEN" });
    expect(store.size).toBe(0);
    expect(logged).toHaveLength(0);
  });

  it("sans accès Partenaires : même refus", async () => {
    expect(await saveBranchAddress(blocked, branch("Interdit"))).toMatchObject({ success: false, code: "FORBIDDEN" });
    expect(store.size).toBe(0);
  });
});

describe("plafond de 200 fiches", () => {
  const filled = (count: number) => ({
    branches: Array.from({ length: count }, (_, index) => ({ id: `f${index}`, compagnie: "CAAR", nom: `Fiche ${index}`, contact: "", telephones: "", adresse: "Adresse", remarque: "" })),
    emsSociete: "EMS",
    emsContacts: [],
  });

  it("refuse l'ajout au-delà du plafond, sans rien écraser ; la modification d'une fiche existante reste possible", async () => {
    store.set("courrier:adresses", { value: filled(MAX_FICHES), updatedAt: new Date(1) });
    const refused = await saveBranchAddress(writer, branch("Une de trop"));
    expect(refused).toMatchObject({ success: false, code: "VALIDATION" });
    expect(refused.success ? "" : refused.error).toContain("200");
    const refusedEms = await saveEmsContactEntry(writer, { nom: "Trop", role: "RAMASSEUR", telephone: "0550 00 00 00", email: "", remarque: "" });
    expect(refusedEms).toMatchObject({ success: false, code: "VALIDATION" });
    expect(stored()?.branches).toHaveLength(MAX_FICHES);
    const edit = await saveBranchAddress(writer, { ...branch("Fiche 0 corrigée"), id: "f0" });
    expect(edit.success).toBe(true);
  });

  it("un ajout est accepté tant qu'il reste une place", async () => {
    store.set("courrier:adresses", { value: filled(MAX_FICHES - 1), updatedAt: new Date(1) });
    expect((await saveBranchAddress(writer, branch("La dernière"))).success).toBe(true);
    expect(stored()?.branches).toHaveLength(MAX_FICHES);
  });
});

describe("concurrence (écriture conditionnelle sur updatedAt)", () => {
  it("deux ajouts simultanés sur une clé existante : aucun n'est perdu", async () => {
    await saveBranchAddress(writer, branch("Base"));
    hooks.interleave = true;
    const [first, second] = await Promise.all([saveBranchAddress(writer, branch("Alpha")), saveBranchAddress(writer, branch("Beta"))]);
    expect(first.success && second.success).toBe(true);
    const names = stored()?.branches.map((item) => item.nom) ?? [];
    expect(names).toEqual(expect.arrayContaining(["Base", "Alpha", "Beta"]));
    expect(names).toHaveLength(16);
  });

  it("deux ajouts simultanés quand la clé n'existe pas encore : la liste de départ n'est pas dupliquée ni écrasée", async () => {
    hooks.interleave = true;
    const [first, second] = await Promise.all([saveBranchAddress(writer, branch("Alpha")), saveBranchAddress(writer, branch("Beta"))]);
    expect(first.success && second.success).toBe(true);
    const book = stored();
    expect(book?.branches).toHaveLength(15);
    expect(book?.branches.filter((item) => item.id === "caar-oran-400")).toHaveLength(1);
  });

  it("une suppression et une modification simultanées sont toutes deux appliquées", async () => {
    await saveBranchAddress(writer, branch("Base"));
    hooks.interleave = true;
    const [removed, edited] = await Promise.all([deleteBranchAddress(writer, { id: "caat-setif" }), saveBranchAddress(writer, { ...branch("SUCCURSALE CAAR ORAN 400", { telephones: "041 99 99 99" }), id: "caar-oran-400" })]);
    expect(removed.success && edited.success).toBe(true);
    const book = stored();
    expect(book?.branches.some((item) => item.id === "caat-setif")).toBe(false);
    expect(book?.branches.find((item) => item.id === "caar-oran-400")?.telephones).toBe("041 99 99 99");
  });

  it("écriture toujours refusée : conflit explicite après 5 tentatives, journal muet", async () => {
    await saveBranchAddress(writer, branch("Base"));
    logged.length = 0;
    hooks.failWrites = true;
    const result = await saveBranchAddress(writer, branch("Perdue"));
    expect(result).toMatchObject({ success: false, code: "CONFLICT" });
    expect(result.success ? "" : result.error).toContain("en même temps");
    expect(stored()?.branches.some((item) => item.nom === "Perdue")).toBe(false);
    expect(logged).toHaveLength(0);
  });

  it("updatedAt modifié entre la lecture et l'écriture : nouvelle tentative sur la version récente", async () => {
    await saveBranchAddress(writer, branch("Base"));
    const before = store.get("courrier:adresses");
    expect(before).toBeDefined();
    // Un collègue écrit pendant qu'on lit : la première écriture échoue, la seconde repart de sa version.
    hooks.interleave = true;
    const pending = saveBranchAddress(writer, branch("Moi"));
    store.set("courrier:adresses", { value: { ...(structuredClone(before!.value) as object), emsSociete: "EMS Poste" }, updatedAt: new Date(++clock) });
    expect((await pending).success).toBe(true);
    const book = stored();
    expect(book?.emsSociete).toBe("EMS Poste");
    expect(book?.branches.some((item) => item.nom === "Moi")).toBe(true);
  });
});
