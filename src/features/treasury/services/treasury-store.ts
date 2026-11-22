import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { fail, ok, type ActionResult, type ErrorCode } from "@/types";

/** Clé du solde (méta d'import du relevé, secours manuel, dernier refus). */
export const KEY_SOLDE = "tresorerie:solde";
/** Clé des scénarios de simulation. */
export const KEY_SCENARIOS = "tresorerie:scenarios";
/** Clé des réglages (réserve en jours, encaissements attendus). */
export const KEY_SETTINGS = "tresorerie:reglages";

/** Préfixe des clés du scénario actif de chaque utilisateur. */
export const KEY_ACTIVE_PREFIX = "tresorerie:actif:";

/** Clé du scénario actif d'un utilisateur : l'activation d'un scénario ne concerne que celui qui l'a faite. */
export function keyActive(userId: string): string {
  return `${KEY_ACTIVE_PREFIX}${userId}`;
}

/** Résultat d'un calcul de nouvel état : état suivant ou refus. */
export type StateChange<S> = { ok: true; state: S } | { ok: false; error: string; code: ErrorCode };

/** Lit un réglage et le fait passer par la lecture tolérante `parse` (valeur absente ou illisible : état par défaut). */
export async function readState<S>(key: string, parse: (value: unknown) => S): Promise<S> {
  const row = await db.setting.findUnique({ where: { key } });
  return parse(row?.value);
}

/**
 * Lecture, modification et écriture d'un réglage, sûres en concurrence : écriture conditionnelle sur `updatedAt` de la ligne
 * (même principe que les validations d'anomalies RH), avec jusqu'à 5 tentatives. `compute` reçoit l'état lu et renvoie le nouvel état ou un refus.
 */
export async function updateState<S>(key: string, parse: (value: unknown) => S, compute: (state: S) => StateChange<S>): Promise<ActionResult<S>> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const row = await db.setting.findUnique({ where: { key } });
    const next = compute(parse(row?.value));
    if (!next.ok) return fail(next.error, next.code);
    const value = JSON.parse(JSON.stringify(next.state)) as Prisma.InputJsonValue;
    const written = row
      ? (await db.setting.updateMany({ where: { key, updatedAt: row.updatedAt }, data: { value } })).count
      : (await db.setting.createMany({ data: [{ key, value }], skipDuplicates: true })).count;
    if (written === 1) return ok(next.state);
  }
  return fail("La trésorerie a été modifiée en même temps par quelqu'un d'autre. Réessayez.", "CONFLICT");
}
