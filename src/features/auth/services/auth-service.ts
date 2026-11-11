import { db } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/password";
import { isAdminProfile, resolveAccess } from "@/features/access/services/access-rules";
import type { AuthUser } from "@/features/access/types";
import type { ChangePasswordInput, LoginInput } from "@/features/auth/schemas";
import { logAction } from "@/features/journal/services/journal-service";
import { fail, ok, type ActionResult } from "@/types";

const BAD_CREDENTIALS = "Adresse e-mail ou mot de passe incorrect.";

/* Protection contre les essais de mots de passe en série : 5 échecs en 15 minutes bloquent l'adresse 15 minutes.
   Le compteur est gardé en base (table Setting) : il tient même quand le site tourne sur plusieurs serveurs. */
const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60 * 1000;

interface FailureEntry {
  count: number;
  first: number;
  lockedUntil: number;
}

const failureKey = (email: string): string => `login:${email.trim().toLowerCase()}`;

async function readFailures(email: string): Promise<FailureEntry | null> {
  const row = await db.setting.findUnique({ where: { key: failureKey(email) } });
  const value = row?.value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { count, first, lockedUntil } = value as Record<string, unknown>;
  return { count: Number(count) || 0, first: Number(first) || 0, lockedUntil: Number(lockedUntil) || 0 };
}

async function lockedMinutes(email: string): Promise<number> {
  const entry = await readFailures(email);
  if (!entry) return 0;
  const now = Date.now();
  if (entry.lockedUntil > now) return Math.ceil((entry.lockedUntil - now) / 60000);
  if (now - entry.first > WINDOW_MS) await clearFailures(email);
  return 0;
}

async function recordFailure(email: string): Promise<void> {
  const now = Date.now();
  const entry = await readFailures(email);
  const next: FailureEntry = !entry || now - entry.first > WINDOW_MS ? { count: 1, first: now, lockedUntil: 0 } : { ...entry, count: entry.count + 1 };
  if (next.count >= MAX_FAILURES) next.lockedUntil = now + WINDOW_MS;
  const value = { count: next.count, first: next.first, lockedUntil: next.lockedUntil };
  await db.setting.upsert({ where: { key: failureKey(email) }, create: { key: failureKey(email), value }, update: { value } });
}

async function clearFailures(email: string): Promise<void> {
  await db.setting.deleteMany({ where: { key: failureKey(email) } });
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
  const locked = await lockedMinutes(input.email).catch(() => 0);
  if (locked) return fail(`Trop d'essais avec cette adresse. Réessayez dans ${locked} minute(s).`, "UNAUTHENTICATED");
  try {
    const user = await db.user.findUnique({ where: { email: input.email } });
    if (!user || !user.active || !user.passwordHash) {
      await recordFailure(input.email);
      return fail(BAD_CREDENTIALS, "UNAUTHENTICATED");
    }
    const valid = await verifyPassword(input.password, user.passwordHash);
    if (!valid) {
      await recordFailure(input.email);
      if (await lockedMinutes(input.email)) console.warn(`[auth] adresse bloquée 15 minutes après ${MAX_FAILURES} échecs : ${input.email}`);
      return fail(BAD_CREDENTIALS, "UNAUTHENTICATED");
    }
    await clearFailures(input.email);
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
