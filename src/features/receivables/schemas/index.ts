import { z } from "zod";

/** Paramètres d'URL de la page des créances (valeurs invalides ignorées). */
export const receivablesQuerySchema = z.object({
  annee: z.coerce.number().int().min(2000).max(2100).optional().catch(undefined),
  activite: z.enum(["ASSISTANCE", "BDG"]).optional().catch(undefined),
  /** Panneau de détail : « CAAT » ou « CAAT:BDG ». */
  detail: z.string().trim().min(1).max(90).optional().catch(undefined),
  /** Relance : factures de plus de 30, 60 ou 90 jours (ou sans date). */
  anc: z.coerce.number().int().refine((value) => value === 30 || value === 60 || value === 90).optional().catch(undefined),
});

/** Filtres validés de la page des créances. */
export type ReceivablesQuery = z.infer<typeof receivablesQuerySchema>;

/** Mail à la direction : compagnie, année facultative et filtre d'ancienneté (0 = toutes les factures impayées, ou plus de 30, 60 ou 90 jours). */
export const impayesMailSchema = z.object({
  company: z.string().trim().min(1).max(80),
  annee: z.coerce.number().int().min(2000).max(2100).optional(),
  jours: z.coerce.number().int().refine((value) => value === 0 || value === 30 || value === 60 || value === 90).default(0),
});
/** Demande de mail validée. */
export type ImpayesMailInput = z.infer<typeof impayesMailSchema>;
