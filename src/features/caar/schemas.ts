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

const pct = z.coerce.number().min(0, "Taux invalide.").max(100, "Taux invalide.");
/** Barème et taux saisis (taux et coefficients en pourcentage). */
export const caarBaremeSchema = z.object({
  prices: z.record(z.string(), z.coerce.number().min(0, "Tarif invalide.").max(1_000_000, "Tarif trop élevé.")),
  coefs: z.array(pct).length(4),
  avFee: z.coerce.number().min(0, "Frais invalides.").max(100_000, "Frais trop élevés."),
  options: z.object({ prorata: z.boolean(), avFull: z.boolean(), avAnyCoef: z.boolean(), palierAll: z.boolean(), feeAll: z.boolean() }),
  rates: z.object({ allo: pct, av: pct, tva: pct }),
  reset: z.boolean().optional(),
});
/** Barème saisi. */
export type CaarBaremeInput = z.infer<typeof caarBaremeSchema>;
