import { db } from "@/lib/db";
import type { Prisma, ProviderRib } from "@/generated/prisma/client";
import { can, requireAccess, requireAdmin } from "@/features/access/services/access-rules";
import type { AuthUser } from "@/features/access/types";
import { logAction } from "@/features/journal/services/journal-service";
import type { RibActionInput, RibQuery, RibSaveInput } from "@/features/transfers/schemas";
import { accountKey, ribValid } from "@/features/transfers/services/rib";
import { readTransferLines } from "@/features/transfers/services/transfer-lines";
import type { ProviderRibDTO } from "@/features/transfers/types";
import { fail, ok, type ActionResult } from "@/types";
import { round2 } from "@/utils/amounts";

function obj(value: Prisma.JsonValue | unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function toDTO(rib: ProviderRib, history: Map<string, { count: number; total: number; lastRef: string | null }>): ProviderRibDTO {
  const extra = obj(rib.extra);
  const proposed = obj(extra.propose);
  const change = obj(extra.change);
  return {
    id: rib.id,
    key: rib.key,
    rib: rib.rib,
    code: rib.code,
    noms: rib.noms,
    types: rib.types,
    wilaya: rib.wilaya,
    status: rib.status,
    origine: rib.origine,
    isNew: Boolean(extra.nouveau),
    proposed: proposed.rib ? { rib: String(proposed.rib), envoi: String(proposed.envoi ?? ""), by: String(proposed.parNom ?? "") } : null,
    change: change.type ? { type: String(change.type), others: Array.isArray(change.autres) ? change.autres.map(String) : [] } : null,
    oldRibs: Array.isArray(extra.anciens) ? extra.anciens.flatMap((item) => (obj(item).rib ? [String(obj(item).rib)] : [])) : [],
    history: history.get(rib.key) ?? { count: 0, total: 0, lastRef: null },
  };
}

/** Référentiel RIB des prestataires (filtres : à valider, actifs, supprimés). */
export async function listRibs(actor: AuthUser, query: RibQuery): Promise<ActionResult<{ ribs: ProviderRibDTO[]; counts: Record<string, number>; canEdit: boolean; isAdmin: boolean }>> {
  const guard = requireAccess(actor, "VIR");
  if (!guard.success) return guard;
  const where: Prisma.ProviderRibWhereInput = {
    ...(query.filtre === "a_valider" ? { status: "a_valider" } : query.filtre === "actifs" ? { status: "actif" } : query.filtre === "supprimes" ? { status: { in: ["supprime", "remplace"] } } : {}),
    ...(query.q ? { OR: [{ rib: { contains: query.q.replace(/\s/g, "") } }, { noms: { has: query.q.toUpperCase() } }, { wilaya: { contains: query.q, mode: "insensitive" } }, { code: { contains: query.q, mode: "insensitive" } }] } : {}),
  };
  const [ribs, grouped, batches] = await Promise.all([
    db.providerRib.findMany({ where, orderBy: [{ status: "asc" }, { updatedAt: "desc" }], take: 400 }),
    db.providerRib.groupBy({ by: ["status"], _count: { _all: true } }),
    db.transferBatch.findMany({ where: { status: "valide" }, select: { ref: true, lines: true, updatedAt: true }, orderBy: { updatedAt: "asc" } }),
  ]);
  let filtered = ribs;
  if (query.q && filtered.length === 0) {
    const all = await db.providerRib.findMany({ take: 2000 });
    const needle = query.q.toUpperCase();
    filtered = all.filter((rib) => rib.noms.some((name) => name.includes(needle)));
  }
  const history = new Map<string, { count: number; total: number; lastRef: string | null }>();
  for (const batch of batches) {
    for (const line of readTransferLines(batch.lines)) {
      if (line.sens !== "C") continue;
      const key = `${line.banque}${line.compte}`;
      const entry = history.get(key) ?? { count: 0, total: 0, lastRef: null };
      entry.count += 1;
      entry.total = round2(entry.total + line.montant);
      entry.lastRef = batch.ref;
      history.set(key, entry);
    }
  }
  return ok({
    ribs: filtered.map((rib) => toDTO(rib, history)),
    counts: Object.fromEntries(grouped.map((group) => [group.status, group._count._all])),
    canEdit: can(actor, "VIR", "EDIT"),
    isAdmin: actor.isAdmin,
  });
}

/**
 * Actions sur un compte : valider un changement (administrateur), refuser un RIB proposé, supprimer, restaurer,
 * confirmer un nouveau prestataire. L'ancien RIB est toujours conservé dans l'historique.
 */
export async function ribAction(actor: AuthUser, input: RibActionInput): Promise<ActionResult<string>> {
  const guard = requireAccess(actor, "VIR", "EDIT");
  if (!guard.success) return guard;
  const rib = await db.providerRib.findUnique({ where: { id: input.id } });
  if (!rib) return fail("Compte introuvable.", "NOT_FOUND");
  const extra = obj(rib.extra);
  const name = rib.noms[0] ?? rib.key;
  const now = new Date().toISOString();
  const stamp = { le: now, par: actor.id, nom: actor.name };
  if (input.action === "valider") {
    const admin = requireAdmin(actor);
    if (!admin.success) return fail("La validation d'un changement de RIB est réservée à un administrateur.", "FORBIDDEN");
    const proposed = obj(extra.propose);
    if (proposed.rib) {
      const anciens = Array.isArray(extra.anciens) ? extra.anciens : [];
      const { propose: _removed, ...rest } = extra;
      await db.providerRib.update({
        where: { id: rib.id },
        data: { rib: String(proposed.rib), status: "actif", extra: { ...rest, anciens: [...anciens, { rib: rib.rib, jusquau: now }], valide: { ...stamp, action: "changement de RIB" } } as Prisma.InputJsonObject },
      });
      await logAction(actor, "RIB prestataire validé", `${name} – nouveau RIB ${String(proposed.rib)}`);
      return ok(`Nouveau RIB validé pour ${name}.`);
    }
    await db.providerRib.update({ where: { id: rib.id }, data: { status: "actif", extra: { ...extra, valide: { ...stamp, action: "nouveau compte" } } as Prisma.InputJsonObject } });
    if (input.replaceOld) {
      const change = obj(extra.change);
      const others = Array.isArray(change.autres) ? change.autres.map(String) : [];
      await db.providerRib.updateMany({ where: { key: { in: others }, status: { notIn: ["supprime", "remplace"] } }, data: { status: "remplace" } });
    }
    await logAction(actor, "RIB prestataire validé", `${name} – compte ${rib.rib}${input.replaceOld ? " (ancien compte remplacé)" : ""}`);
    return ok(`Compte validé pour ${name}.`);
  }
  if (input.action === "refuser") {
    const proposed = obj(extra.propose);
    if (!proposed.rib) return fail("Aucun RIB proposé pour ce compte.", "CONFLICT");
    const refuses = Array.isArray(extra.refuses) ? extra.refuses : [];
    const { propose: _removed, ...rest } = extra;
    await db.providerRib.update({ where: { id: rib.id }, data: { status: "actif", extra: { ...rest, refuses: [...refuses, { rib: proposed.rib, le: now, envoi: proposed.envoi }] } as Prisma.InputJsonObject } });
    await logAction(actor, "RIB proposé refusé", `${name} – ${String(proposed.rib)}`);
    return ok("RIB proposé refusé : l'ancien RIB est conservé.");
  }
  if (input.action === "supprimer") {
    await db.providerRib.update({ where: { id: rib.id }, data: { status: "supprime", extra: { ...extra, suppr: `supprimé le ${now.slice(0, 10)} par ${actor.name}` } as Prisma.InputJsonObject } });
    await logAction(actor, "RIB prestataire supprimé", `${name} – ${rib.rib}`);
    return ok("RIB supprimé du référentiel : il sera bloqué s'il réapparaît dans un envoi.");
  }
  if (input.action === "restaurer") {
    const { suppr: _removed, ...rest } = extra;
    await db.providerRib.update({ where: { id: rib.id }, data: { status: "actif", extra: rest as Prisma.InputJsonObject } });
    await logAction(actor, "RIB prestataire restauré", `${name} – ${rib.rib}`);
    return ok("RIB restauré.");
  }
  const { nouveau: _removed, ...rest } = extra;
  await db.providerRib.update({ where: { id: rib.id }, data: { extra: { ...rest, valide: { ...stamp, action: "nouveau prestataire confirmé" } } as Prisma.InputJsonObject } });
  return ok("Prestataire confirmé.");
}

/** Ajoute ou modifie un compte du référentiel (RIB contrôlé : 20 chiffres et clé). */
export async function saveRib(actor: AuthUser, input: RibSaveInput): Promise<ActionResult<{ id: string }>> {
  const guard = requireAccess(actor, "VIR", "EDIT");
  if (!guard.success) return guard;
  if (!ribValid(input.rib)) return fail("Clé RIB incorrecte : vérifiez l'agence, le compte et la clé.", "VALIDATION");
  const key = accountKey(input.rib);
  const noms = input.noms.map((name) => name.toUpperCase());
  try {
    if (input.id) {
      const current = await db.providerRib.findUnique({ where: { id: input.id } });
      if (!current) return fail("Compte introuvable.", "NOT_FOUND");
      if (current.rib !== input.rib && !actor.isAdmin) {
        await db.providerRib.update({
          where: { id: current.id },
          data: { noms, types: input.types, wilaya: input.wilaya.toUpperCase(), code: input.code, status: "a_valider", extra: { ...obj(current.extra), propose: { rib: input.rib, envoi: "saisie manuelle", le: new Date().toISOString(), par: actor.id, parNom: actor.name } } as Prisma.InputJsonObject },
        });
        await logAction(actor, "Changement de RIB signalé", `${noms[0]} : ${current.rib} → ${input.rib}`);
        return ok({ id: current.id });
      }
      const extra = obj(current.extra);
      const anciens = current.rib !== input.rib ? [...(Array.isArray(extra.anciens) ? extra.anciens : []), { rib: current.rib, jusquau: new Date().toISOString() }] : extra.anciens;
      await db.providerRib.update({
        where: { id: current.id },
        data: { rib: input.rib, key, noms, types: input.types, wilaya: input.wilaya.toUpperCase(), code: input.code, extra: { ...extra, anciens } as Prisma.InputJsonObject },
      });
      await logAction(actor, "RIB prestataire modifié", `${noms[0]} – ${input.rib}`);
      return ok({ id: current.id });
    }
    const existing = await db.providerRib.findFirst({ where: { key } });
    if (existing) return fail(`Ce compte existe déjà dans le référentiel (${existing.noms.join(" / ")}).`, "CONFLICT");
    const created = await db.providerRib.create({
      data: { legacyId: `r${key}`, key, rib: input.rib, noms, types: input.types, wilaya: input.wilaya.toUpperCase(), code: input.code, status: actor.isAdmin ? "actif" : "a_valider", origine: "saisie manuelle", extra: { nouveau: true } },
    });
    await logAction(actor, "RIB prestataire ajouté", `${noms[0]} – ${input.rib}`);
    return ok({ id: created.id });
  } catch (error) {
    console.error("[rib] enregistrement :", error);
    return fail("Le compte n'a pas pu être enregistré.", "DATABASE");
  }
}

/** Nombre de comptes à valider (badge). */
export async function ribsToValidate(): Promise<number> {
  return db.providerRib.count({ where: { status: "a_valider" } });
}
