import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import type { AuthUser } from "@/features/access/types";
import { requireAdmin } from "@/features/access/services/access-rules";
import type { JournalItem, JournalQuery } from "@/features/journal/types";
import { fail, ok, type ActionResult, type Paginated } from "@/types";

const PAGE_SIZE = 50;

function asRecord(value: Prisma.JsonValue | null | undefined): Record<string, string | number | boolean | null> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, string | number | boolean | null>) : null;
}

/** Trace d'une modification : objet touché et son état avant / après (valeurs simples). */
export interface JournalTrace {
  entity: string;
  entityId: string;
  avant: Record<string, string | number | boolean | null>;
  apres: Record<string, string | number | boolean | null>;
}

/**
 * Enregistre une action dans le journal. N'interrompt jamais l'opération métier :
 * une erreur d'écriture du journal est seulement tracée dans les logs serveur.
 */
export async function logAction(actor: AuthUser, action: string, objet: string, admin = false, trace?: JournalTrace): Promise<void> {
  try {
    await db.journalEntry.create({
      data: {
        userId: actor.id,
        userName: actor.name,
        action,
        objet,
        admin,
        ...(trace ? { entity: trace.entity, entityId: trace.entityId, avant: trace.avant as Prisma.InputJsonObject, apres: trace.apres as Prisma.InputJsonObject } : {}),
      },
    });
  } catch (error) {
    console.error("[journal] écriture impossible :", error);
  }
}

/**
 * Liste paginée du journal. Le journal d'administration (RH, accès) est réservé aux administrateurs ;
 * le journal général est visible par tous les utilisateurs connectés.
 */
export async function listJournal(actor: AuthUser, query: JournalQuery): Promise<ActionResult<Paginated<JournalItem>>> {
  if (query.scope === "admin") {
    const guard = requireAdmin(actor);
    if (!guard.success) return guard;
  }
  const where = {
    admin: query.scope === "admin",
    ...(query.q
      ? {
          OR: [
            { action: { contains: query.q, mode: "insensitive" as const } },
            { objet: { contains: query.q, mode: "insensitive" as const } },
            { userName: { contains: query.q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };
  try {
    const [total, rows] = await Promise.all([
      db.journalEntry.count({ where }),
      db.journalEntry.findMany({
        where,
        orderBy: { at: "desc" },
        skip: (query.page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
    ]);
    return ok({
      items: rows.map((row) => ({
        id: row.id,
        at: row.at.toISOString(),
        userName: row.userName,
        action: row.action,
        objet: row.objet,
        admin: row.admin,
        avant: asRecord(row.avant),
        apres: asRecord(row.apres),
      })),
      total,
      page: query.page,
      pageSize: PAGE_SIZE,
      pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    });
  } catch (error) {
    console.error("[journal] lecture impossible :", error);
    return fail("Le journal n'a pas pu être chargé.", "DATABASE");
  }
}
