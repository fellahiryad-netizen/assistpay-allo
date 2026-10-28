import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { requireAdmin } from "@/features/access/services/access-rules";
import type { AuthUser } from "@/features/access/types";
import { logAction } from "@/features/journal/services/journal-service";
import { MONTHLY_DOUBLE_CHECK } from "@/features/transfers/services/rib";
import { ok, type ActionResult } from "@/types";
import { formatDA } from "@/utils/format";

/** Paramètres de contrôle réglables par un administrateur. */
export interface ControlSettings {
  /** Seuil de double validation : cumul mensuel viré à un même prestataire (DA). */
  seuil: number;
  /** N° d'article d'imposition d'EURL Allo Assistance (mention des factures). */
  articleImposition: string;
}

function obj(value: Prisma.JsonValue | undefined): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** Lecture des paramètres (valeurs par défaut si rien n'est enregistré). */
export async function getControlSettings(): Promise<ControlSettings> {
  const row = await db.setting.findUnique({ where: { key: "controle" } });
  const value = obj(row?.value);
  const seuil = Number(value.seuil);
  return { seuil: Number.isFinite(seuil) && seuil > 0 ? seuil : MONTHLY_DOUBLE_CHECK, articleImposition: typeof value.ai === "string" ? value.ai : "" };
}

/** Enregistrement des paramètres (administrateur). */
export async function saveControlSettings(actor: AuthUser, input: ControlSettings): Promise<ActionResult<ControlSettings>> {
  const guard = requireAdmin(actor);
  if (!guard.success) return guard;
  const value = { seuil: input.seuil, ai: input.articleImposition.trim(), maj: { le: new Date().toISOString(), nom: actor.name } };
  await db.setting.upsert({ where: { key: "controle" }, create: { key: "controle", value }, update: { value } });
  await logAction(actor, "Paramètres de contrôle", `Seuil ${formatDA(input.seuil)} · article d'imposition « ${value.ai || "—"} »`);
  return ok({ seuil: input.seuil, articleImposition: value.ai });
}
