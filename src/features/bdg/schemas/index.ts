import { z } from "zod";

/** Filtres de la liste BDG. */
export const bdgQuerySchema = z.object({
  etat: z.enum(["ouvert", "REGLE", "ANNULE", "tous"]).default("ouvert").catch("ouvert"),
  categorie: z.string().trim().max(120).optional().catch(undefined),
});
export type BdgQuery = z.infer<typeof bdgQuerySchema>;

/** Règlement d'une partie (débours ou frais) d'une facture BDG. */
export const settlePartSchema = z.object({
  id: z.string().min(1).max(64),
  part: z.enum(["debours", "frais", "tout"]),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  mode: z.enum(["VIREMENT", "CHEQUE", "VERSEMENT", "AUTRE"]),
  reference: z.string().trim().max(80).default(""),
});
export type SettlePartInput = z.infer<typeof settlePartSchema>;
