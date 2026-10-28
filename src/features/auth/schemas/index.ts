import { z } from "zod";

/** Formulaire de connexion. */
export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Adresse e-mail invalide."),
  password: z.string().min(1, "Mot de passe requis.").max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

/** Changement de son propre mot de passe. */
export const changePasswordSchema = z
  .object({
    current: z.string().min(1, "Mot de passe actuel requis."),
    next: z.string().min(10, "10 caractères minimum.").max(200),
    confirm: z.string(),
  })
  .refine((value) => value.next === value.confirm, { path: ["confirm"], message: "Les deux saisies diffèrent." });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
