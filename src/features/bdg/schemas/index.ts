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

/** Réglages du récapitulatif des factures BDG GAM. */
export const etatsOptionsSchema = z.object({
  tva: z.coerce.number().min(0, "TVA invalide.").max(100, "TVA invalide.").default(19),
  exclure: z.string().trim().max(200).default("Préstation; Frais de gestion"),
  mois: z.preprocess((value) => (value === "" || value === null || value === undefined ? null : value), z.coerce.number().int().min(1).max(12).nullable()).default(null),
  /** Papier en-tête (logo et pied de page Allo Assistance) : « 1 » ou « 0 ». */
  logo: z.preprocess((value) => value !== "0" && value !== "false" && value !== false, z.boolean()).default(true),
  /** Marges haute et basse en centimètres (impression et Excel). */
  mh: z.coerce.number().min(0.5, "Marge invalide.").max(5, "Marge invalide.").default(1.5),
  mb: z.coerce.number().min(0.5, "Marge invalide.").max(5, "Marge invalide.").default(1.5),
  /** Export d'un seul état : -1 = récapitulatif, n = agence n ; vide = tous. */
  only: z.preprocess((value) => (value === "" || value === null || value === undefined ? null : value), z.coerce.number().int().min(-1).max(500).nullable()).default(null),
});
export type EtatsOptionsInput = z.infer<typeof etatsOptionsSchema>;
