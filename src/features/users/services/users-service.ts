import { db } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { LEVEL_LABELS, MODULES, PROFILE_DEFAULTS, PROFILE_LABELS, isAdminProfile, requireAdmin, resolveAccess } from "@/features/access/services/access-rules";
import type { AccessLevelKey, AuthUser, ModuleKey } from "@/features/access/types";
import { logAction } from "@/features/journal/services/journal-service";
import type {
  CreateUserInput,
  ResetPasswordInput,
  SetActiveInput,
  SetModuleAccessInput,
  SetProfileInput,
} from "@/features/users/schemas";
import type { UserAccessRow } from "@/features/users/types";
import { fail, ok, type ActionResult } from "@/types";

function displayName(user: { firstName: string; lastName: string; email: string }): string {
  return `${user.firstName} ${user.lastName}`.trim() || user.email;
}

/** Tableau des accès : tous les utilisateurs avec leur accès effectif et leurs exceptions. */
export async function listUserAccess(actor: AuthUser): Promise<ActionResult<UserAccessRow[]>> {
  const guard = requireAdmin(actor);
  if (!guard.success) return guard;
  try {
    const users = await db.user.findMany({ include: { access: true }, orderBy: [{ active: "desc" }, { lastName: "asc" }] });
    return ok(
      users.map((user) => ({
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        profile: user.profile,
        active: user.active,
        hasPassword: Boolean(user.passwordHash),
        lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
        access: resolveAccess(user.profile, user.access),
        overrides: Object.fromEntries(user.access.map((item) => [item.module, item.level])) as Partial<
          Record<ModuleKey, AccessLevelKey>
        >,
      })),
    );
  } catch (error) {
    console.error("[users] liste impossible :", error);
    return fail("La liste des utilisateurs n'a pas pu être chargée.", "DATABASE");
  }
}

/** Fixe (ou retire) l'exception d'accès d'un utilisateur sur un onglet. */
export async function setModuleAccess(actor: AuthUser, input: SetModuleAccessInput): Promise<ActionResult<true>> {
  const guard = requireAdmin(actor);
  if (!guard.success) return guard;
  try {
    const user = await db.user.findUnique({ where: { id: input.userId } });
    if (!user) return fail("Utilisateur introuvable.", "NOT_FOUND");
    if (input.level === null) {
      await db.userModuleAccess.deleteMany({ where: { userId: input.userId, module: input.module } });
    } else {
      await db.userModuleAccess.upsert({
        where: { userId_module: { userId: input.userId, module: input.module } },
        create: { userId: input.userId, module: input.module, level: input.level },
        update: { level: input.level },
      });
    }
    const label = MODULES.find((item) => item.key === input.module)?.label ?? input.module;
    const level = input.level ? LEVEL_LABELS[input.level] : "niveau du profil";
    await logAction(actor, "Accès modifié", `${displayName(user)} – ${label} : ${level}`, true);
    return ok(true);
  } catch (error) {
    console.error("[users] accès impossible à modifier :", error);
    return fail("L'accès n'a pas pu être enregistré.", "DATABASE");
  }
}

/** Change le profil d'un utilisateur (les exceptions déjà choisies sont conservées). */
export async function setUserProfile(actor: AuthUser, input: SetProfileInput): Promise<ActionResult<true>> {
  const guard = requireAdmin(actor);
  if (!guard.success) return guard;
  if (input.userId === actor.id && input.profile !== actor.profile) {
    return fail("Vous ne pouvez pas changer votre propre profil.", "FORBIDDEN");
  }
  try {
    const user = await db.user.update({ where: { id: input.userId }, data: { profile: input.profile } });
    await logAction(actor, "Profil modifié", `${displayName(user)} : ${PROFILE_LABELS[input.profile]}`, true);
    return ok(true);
  } catch (error) {
    console.error("[users] profil impossible à modifier :", error);
    return fail("Le profil n'a pas pu être enregistré.", "DATABASE");
  }
}

/** Active ou désactive un compte. Un administrateur ne peut pas se désactiver lui-même. */
export async function setUserActive(actor: AuthUser, input: SetActiveInput): Promise<ActionResult<true>> {
  const guard = requireAdmin(actor);
  if (!guard.success) return guard;
  if (input.userId === actor.id) return fail("Vous ne pouvez pas désactiver votre propre compte.", "FORBIDDEN");
  try {
    const user = await db.user.update({ where: { id: input.userId }, data: { active: input.active } });
    await logAction(actor, input.active ? "Compte réactivé" : "Compte désactivé", displayName(user), true);
    return ok(true);
  } catch (error) {
    console.error("[users] activation impossible :", error);
    return fail("Le compte n'a pas pu être modifié.", "DATABASE");
  }
}

/** Crée un compte avec un mot de passe initial. */
export async function createUser(actor: AuthUser, input: CreateUserInput): Promise<ActionResult<{ id: string }>> {
  const guard = requireAdmin(actor);
  if (!guard.success) return guard;
  try {
    const existing = await db.user.findUnique({ where: { email: input.email } });
    if (existing) return fail("Un compte existe déjà avec cette adresse.", "CONFLICT");
    const user = await db.user.create({
      data: {
        id: `u_${crypto.randomUUID().replace(/-/g, "").slice(0, 22)}`,
        email: input.email,
        firstName: input.firstName,
        lastName: input.lastName.toUpperCase(),
        profile: input.profile,
        passwordHash: await hashPassword(input.password),
      },
    });
    // Seuls les écarts avec le profil sont enregistrés (exceptions du tableau des accès).
    const overrides = isAdminProfile(input.profile)
      ? []
      : MODULES.filter((module) => input.access[module.key] && input.access[module.key] !== PROFILE_DEFAULTS[input.profile][module.key]).map((module) => ({
          userId: user.id,
          module: module.key,
          level: input.access[module.key] as AccessLevelKey,
        }));
    if (overrides.length) await db.userModuleAccess.createMany({ data: overrides });
    const summary = isAdminProfile(input.profile)
      ? "tous les droits"
      : MODULES.map((module) => `${module.label} : ${LEVEL_LABELS[input.access[module.key] ?? PROFILE_DEFAULTS[input.profile][module.key]]}`).join(", ");
    await logAction(actor, "Compte créé", `${displayName(user)} (${PROFILE_LABELS[input.profile]}) – ${summary}`.slice(0, 500), true);
    return ok({ id: user.id });
  } catch (error) {
    console.error("[users] création impossible :", error);
    return fail("Le compte n'a pas pu être créé.", "DATABASE");
  }
}

/** Définit un nouveau mot de passe pour un compte (oubli, première connexion). */
export async function resetUserPassword(actor: AuthUser, input: ResetPasswordInput): Promise<ActionResult<true>> {
  const guard = requireAdmin(actor);
  if (!guard.success) return guard;
  try {
    const user = await db.user.update({ where: { id: input.userId }, data: { passwordHash: await hashPassword(input.password) } });
    await logAction(actor, "Mot de passe réinitialisé", displayName(user), true);
    return ok(true);
  } catch (error) {
    console.error("[users] réinitialisation impossible :", error);
    return fail("Le mot de passe n'a pas pu être enregistré.", "DATABASE");
  }
}
