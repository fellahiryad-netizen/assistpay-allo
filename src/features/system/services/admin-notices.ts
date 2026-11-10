import { db } from "@/lib/db";
import { requireAdmin } from "@/features/access/services/access-rules";
import type { AuthUser } from "@/features/access/types";
import { fail, ok, type ActionResult } from "@/types";

/** Alerte adressée aux administrateurs (table « Setting », clé notice:<horodatage>-<id>). */
export interface AdminNotice {
  id: string;
  at: string;
  titre: string;
  lignes: string[];
  par: string;
}

const PREFIX = "notice:";

/** Dépose une alerte pour les administrateurs. Un échec est journalisé sans bloquer l'opération qui l'a déclenchée. */
export async function notifyAdmins(input: { titre: string; lignes: string[]; par: string }): Promise<void> {
  try {
    const at = new Date().toISOString();
    const key = `${PREFIX}${at}-${crypto.randomUUID().slice(0, 8)}`;
    await db.setting.create({ data: { key, value: { at, titre: input.titre, lignes: input.lignes, par: input.par, lu: false } } });
  } catch (error) {
    console.error("[alertes] alerte administrateur non enregistrée :", error);
  }
}

/** Alertes non lues (administrateurs), plus récentes d'abord. */
export async function listAdminNotices(actor: AuthUser): Promise<AdminNotice[]> {
  if (!actor.isAdmin) return [];
  try {
    const rows = await db.setting.findMany({ where: { key: { startsWith: PREFIX } }, orderBy: { key: "desc" }, take: 100 });
    return rows.flatMap((row: { key: string; value: unknown }) => {
      const value = (row.value ?? {}) as Record<string, unknown>;
      if (value.lu === true) return [];
      return [{ id: row.key, at: String(value.at ?? ""), titre: String(value.titre ?? ""), lignes: Array.isArray(value.lignes) ? value.lignes.map(String) : [], par: String(value.par ?? "") }];
    });
  } catch (error) {
    console.error("[alertes] lecture impossible :", error);
    return [];
  }
}

/** Marque une alerte comme vue (administrateurs). */
export async function dismissAdminNotice(actor: AuthUser, id: string): Promise<ActionResult<true>> {
  const guard = requireAdmin(actor);
  if (!guard.success) return guard;
  if (!id.startsWith(PREFIX)) return fail("Alerte introuvable.", "NOT_FOUND");
  try {
    const row = await db.setting.findUnique({ where: { key: id } });
    if (!row) return fail("Alerte introuvable.", "NOT_FOUND");
    await db.setting.update({ where: { key: id }, data: { value: { ...((row.value ?? {}) as Record<string, unknown>), lu: true, luPar: actor.name, luLe: new Date().toISOString() } } });
    return ok(true);
  } catch (error) {
    console.error("[alertes] mise à jour impossible :", error);
    return fail("L'alerte n'a pas pu être mise à jour.", "DATABASE");
  }
}
