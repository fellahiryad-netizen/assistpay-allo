import { z } from "zod";

/** Succursales CAAR suivies. */
export const CAAR_BRANCHES = ["Cheraga", "Bouzareah", "Oran", "Constantine", "Annaba"] as const;

/** Période et succursale d'un fichier de production. */
export const caarSaveSchema = z.object({
  annee: z.coerce.number().int().min(2020, "Année invalide.").max(2100, "Année invalide."),
  mois: z.coerce.number().int().min(1, "Mois invalide.").max(12, "Mois invalide."),
  succursale: z.enum(CAAR_BRANCHES, { errorMap: () => ({ message: "Choisissez la succursale." }) }),
});
/** Données validées de période / succursale. */
export type CaarSaveInput = z.infer<typeof caarSaveSchema>;
