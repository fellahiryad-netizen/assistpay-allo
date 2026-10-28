import { z } from "zod";

/** Paramètres de contrôle saisis par un administrateur. */
export const controlSettingsSchema = z.object({
  seuil: z.coerce.number().int("Seuil invalide.").min(100_000, "Le seuil doit être d'au moins 100 000 DA.").max(1_000_000_000, "Seuil trop élevé."),
  articleImposition: z.string().trim().max(60, "60 caractères au maximum."),
});
/** Paramètres validés. */
export type ControlSettingsInput = z.infer<typeof controlSettingsSchema>;
