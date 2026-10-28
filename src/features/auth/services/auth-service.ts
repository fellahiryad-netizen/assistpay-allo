import { db } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/password";
import { isAdminProfile, resolveAccess } from "@/features/access/services/access-rules";
import type { AuthUser } from "@/features/access/types";
import type { ChangePasswordInput, LoginInput } from "@/features/auth/schemas";
import { logAction } from "@/features/journal/services/journal-service";
import { fail, ok, type ActionResult } from "@/types";

const BAD_CREDENTIALS = "Adresse e-mail ou mot de passe incorrect.";

/* Protection contre les essais de mots de passe en série : 5 échecs en 15 minutes bloquent l'adresse 15 minutes.
   Compteur en mémoire du serveur : suffisant pour une installation sur un seul serveur. */
const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60 * 1000;
const failures = new Map<string, { count: number; first: number; lockedUntil: number }>();

function lockedMinutes(email: string): number {
  const entry = failures.get(email);
  if (!entry) return 0;
  const now = Date.now();
  if (entry.lockedUntil > now) return Math.ceil((entry.lockedUntil - now) / 60000);
  if (now - entry.first > WINDOW_MS) failures.delete(email);
  return 0;
}

function recordFailure(email: string): void {
  const now = Date.now();
  const entry = failures.get(email);
  if (!entry || now - entry.first > WINDOW_MS) {
    failures.set(email, { count: 1, first: now, lockedUntil: 0 });
    return;
  }
  entry.count += 1;
  if (entry.count >= MAX_FAILURES) entry.lockedUntil = now + WINDOW_MS;
}

/** Charge l'utilisateur et calcule son accès effectif ; `null` s'il n'existe pas ou est désactivé. */
export async function loadAuthUser(userId: string): Promise<AuthUser | null> {
  try {
    const user = await db.user.findUnique({ where: { id: userId }, include: { access: true } });
    if (!user || !user.active) return null;
    return {
      id: user.id,
      email: user.email,
      name: `${user.firstName} ${user.lastName}`.trim() || user.email,
      profile: user.profile,
      isAdmin: isAdminProfile(user.profile),
      access: resolveAccess(user.profile, user.access),
    };
  } catch (error) {
    console.error("[auth] chargement utilisateur impossible :", error);
    return null;
  }
}

/** Vérifie les identifiants ; renvoie l'identifiant de l'utilisateur si la connexion est acceptée. */
export async function authenticate(input: LoginInput): Promise<ActionResult<{ userId: string }>> {
  const locked = lockedMinutes(input.email);
  if (locked) return fail(`Trop d'essais avec cette adresse. Réessayez dans ${locked} minute(s).`, "UNAUTHENTICATED");
  try {
    const user = await db.user.findUnique({ where: { email: input.email } });
    if (!user || !user.active || !user.passwordHash) {
      recordFailure(input.email);
      return fail(BAD_CREDENTIALS, "UNAUTHENTICATED");
    }
    const valid = await verifyPassword(input.password, user.passwordHash);
    if (!valid) {
      recordFailure(input.email);
      if (lockedMinutes(input.email)) console.warn(`[auth] adresse bloquée 15 minutes après ${MAX_FAILURES} échecs : ${input.email}`);
      return fail(BAD_CREDENTIALS, "UNAUTHENTICATED");
    }
    failures.delete(input.email);
    await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    const actor = await loadAuthUser(user.id);
    if (actor) await logAction(actor, "Connexion", actor.email);
    return ok({ userId: user.id });
  } catch (error) {
    console.error("[auth] connexion impossible :", error);
    return fail("Connexion impossible pour le moment.", "DATABASE");
  }
}

/** Change le mot de passe de l'utilisateur connecté après vérification de l'ancien. */
export async function changeOwnPassword(actor: AuthUser, input: ChangePasswordInput): Promise<ActionResult<true>> {
  try {
    const user = await db.user.findUnique({ where: { id: actor.id } });
    if (!user?.passwordHash || !(await verifyPassword(input.current, user.passwordHash))) {
      return fail("Mot de passe actuel incorrect.", "VALIDATION");
    }
    await db.user.update({ where: { id: actor.id }, data: { passwordHash: await hashPassword(input.next) } });
    await logAction(actor, "Mot de passe modifié", actor.email);
    return ok(true);
  } catch (error) {
    console.error("[auth] changement de mot de passe impossible :", error);
    return fail("Le mot de passe n'a pas pu être modifié.", "DATABASE");
  }
}
