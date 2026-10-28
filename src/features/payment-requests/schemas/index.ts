import { z } from "zod";
import { DP_MODES, DP_PRODUCTS } from "@/features/payment-requests/types";

/** Filtres de la liste. */
export const dpQuerySchema = z.object({
  filtre: z.enum(["a_valider", "non_payee", "toutes"]).default("toutes").catch("toutes"),
  q: z.string().trim().max(120).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).default(1).catch(1),
});
export type DpQuery = z.infer<typeof dpQuerySchema>;

/** Modification d'une demande. */
export const dpUpdateSchema = z.object({
  id: z.string().min(1).max(64),
  date: z
    .union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal("")])
    .transform((value) => (value ? value : null)),
  beneficiaire: z.string().trim().min(1, "Bénéficiaire requis.").max(200).transform((value) => value.toUpperCase()),
  adresse: z.string().trim().max(200).default(""),
  montant: z.coerce.number().positive("Montant invalide.").max(1e12),
  nature: z.string().trim().max(300).default(""),
  mode: z.enum(DP_MODES),
  produit: z.enum(DP_PRODUCTS),
  pieces: z.array(z.string().trim().max(200)).max(30),
  validate: z.boolean().default(false),
});
export type DpUpdateInput = z.infer<typeof dpUpdateSchema>;

/** Création d'une demande à partir de factures fournisseurs. */
export const dpCreateSchema = z.object({ invoiceIds: z.array(z.string().min(1).max(64)).min(1, "Choisissez au moins une facture.").max(50) });
export type DpCreateInput = z.infer<typeof dpCreateSchema>;

/** Liaison d'une demande à des factures. */
export const dpLinkSchema = z.object({ id: z.string().min(1).max(64), invoiceIds: z.array(z.string().min(1).max(64)).max(50) });
export type DpLinkInput = z.infer<typeof dpLinkSchema>;

/** Identifiant d'une demande. */
export const dpIdSchema = z.string().min(1).max(64);
