import { z } from "zod";
import { ACCESS_LEVELS, MODULE_KEYS, PROFILE_KEYS } from "@/features/access/types";

/** Identifiant d'utilisateur (format repris de l'ancienne version : u_…, ou cuid). */
export const userIdSchema = z.string().min(3).max(64).regex(/^[A-Za-z0-9_-]+$/, "Identifiant invalide.");

/** Choix d'un niveau pour un onglet (`null` = revenir au niveau du profil). */
export const setModuleAccessSchema = z.object({
  userId: userIdSchema,
  module: z.enum(MODULE_KEYS),
  level: z.enum(ACCESS_LEVELS).nullable(),
});
export type SetModuleAccessInput = z.infer<typeof setModuleAccessSchema>;

/** Changement de profil d'un utilisateur. */
export const setProfileSchema = z.object({ userId: userIdSchema, profile: z.enum(PROFILE_KEYS) });
export type SetProfileInput = z.infer<typeof setProfileSchema>;

/** Activation / désactivation d'un compte. */
export const setActiveSchema = z.object({ userId: userIdSchema, active: z.boolean() });
export type SetActiveInput = z.infer<typeof setActiveSchema>;

/** Création d'un compte par un administrateur. */
export const createUserSchema = z.object({
  email: z.string().trim().toLowerCase().email("Adresse e-mail invalide."),
  firstName: z.string().trim().min(1, "Prénom requis.").max(80),
  lastName: z.string().trim().min(1, "Nom requis.").max(80),
  profile: z.enum(PROFILE_KEYS),
  password: z.string().min(10, "10 caractères minimum.").max(200),
  /** Niveau choisi pour chaque onglet (ignoré pour Administrateur et Direction, qui ont tous les droits). */
  access: z.record(z.enum(MODULE_KEYS), z.enum(ACCESS_LEVELS)).default({}),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

/** Réinitialisation du mot de passe d'un compte par un administrateur. */
export const resetPasswordSchema = z.object({ userId: userIdSchema, password: z.string().min(10, "10 caractères minimum.").max(200) });
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
