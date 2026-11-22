import { z } from "zod";

/** Paramètres d'URL de la page des créances (valeurs invalides ignorées). */
export const receivablesQuerySchema = z.object({
  annee: z.coerce.number().int().min(2000).max(2100).optional().catch(undefined),
  activite: z.enum(["ASSISTANCE", "BDG"]).optional().catch(undefined),
});

/** Filtres validés de la page des créances. */
export type ReceivablesQuery = z.infer<typeof receivablesQuerySchema>;
