import { z } from "zod";

/** Paramètres de la fiche partenaire et de la relance. */
export const partnerQuerySchema = z.object({
  key: z.string().trim().min(1).max(120),
  succ: z.string().trim().max(120).default(""),
  seuil: z.coerce.number().int().min(0).max(365).default(60).catch(60),
  annee: z.union([z.coerce.number().int().min(2000).max(2100), z.literal("all")]).default("all").catch("all"),
});
export type PartnerQuery = z.infer<typeof partnerQuerySchema>;
