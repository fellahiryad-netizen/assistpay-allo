import { z } from "zod";
import { REGUL_PERIODS, REGUL_SUCCURSALES } from "@/features/regul/services/regul-engine";

/** Choix d'une régularisation : succursale, période, année et montants saisis par mois. */
export const regulOptionsSchema = z.object({
  succursale: z.enum(REGUL_SUCCURSALES),
  periode: z.enum(Object.keys(REGUL_PERIODS) as [string, ...string[]]),
  annee: z.coerce.number().int().min(2024).max(2100),
  /** JSON : { "7": { "total": 123, "avance": 456 } } */
  saisies: z.string().max(5000).optional(),
});
export type RegulOptions = z.infer<typeof regulOptionsSchema>;
