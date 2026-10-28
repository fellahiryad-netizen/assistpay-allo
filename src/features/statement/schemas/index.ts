import { z } from "zod";
import { STATEMENT_STATUS_KEYS } from "@/features/statement/types";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Correspondance des colonnes choisie par l'utilisateur. */
export const columnMappingSchema = z.object({
  date: z.coerce.number().int().min(0, "Choisissez la colonne de date."),
  libelle: z.coerce.number().int().min(-1),
  ref: z.coerce.number().int().min(-1),
  credit: z.coerce.number().int().min(-1),
  debit: z.coerce.number().int().min(-1),
  montant: z.coerce.number().int().min(-1),
}).refine((value) => value.credit >= 0 || value.debit >= 0 || value.montant >= 0, {
  message: "Choisissez au moins une colonne de montant (crédit, débit ou montant).",
});

/** Ligne de relevé renvoyée par le navigateur pour validation. */
export const parsedLineSchema = z.object({
  key: z.string().min(5).max(80),
  date: isoDate,
  libelle: z.string().max(500),
  montant: z.number().positive().finite(),
  sens: z.enum(["CREDIT", "DEBIT"]),
  type: z.enum(["CHEQUE", "VIRMT", "VRSMT", ""]),
  numero: z.string().max(80),
});

const partSchema = z.enum(["tout", "debours", "frais"]);

/** Propositions de rapprochement cochées. */
export const applyProposalsSchema = z.object({
  proposals: z
    .array(
      z.object({
        line: parsedLineSchema,
        items: z.array(z.object({ invoiceId: z.string().min(1).max(64), part: partSchema, amount: z.number().positive() })).min(1).max(10),
      }),
    )
    .min(1, "Cochez au moins une proposition.")
    .max(500),
});
export type ApplyProposalsInput = z.infer<typeof applyProposalsSchema>;

/** Filtres de la liste des lignes du relevé. */
export const statementQuerySchema = z.object({
  status: z.enum(STATEMENT_STATUS_KEYS).optional().catch(undefined),
  sens: z.enum(["CREDIT", "DEBIT"]).optional().catch(undefined),
  month: z.string().regex(/^\d{4}-\d{2}$/).optional().catch(undefined),
  q: z.string().trim().max(120).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).default(1).catch(1),
});
export type StatementQuery = z.infer<typeof statementQuerySchema>;

/** Identifiant d'une ligne du relevé. */
export const lineIdSchema = z.string().min(1).max(64);

/** Affectation manuelle d'une ligne à une ou plusieurs factures. */
export const assignLineSchema = z.object({
  lineId: lineIdSchema,
  items: z.array(z.object({ invoiceId: z.string().min(1).max(64), part: partSchema })).min(1, "Choisissez au moins une facture.").max(30),
});
export type AssignLineInput = z.infer<typeof assignLineSchema>;

/** Création d'une facture à partir d'une ligne du relevé (paiement absent du suivi). */
export const createFromLineSchema = z.object({
  lineId: lineIdSchema,
  categorie: z.string().trim().min(1, "Catégorie requise.").max(120),
  tiers: z.string().trim().min(1, "Tiers requis.").max(200),
  numero: z.string().trim().max(80).default(""),
  libelle: z.string().trim().max(500).default(""),
  nature: z.string().trim().max(120).default(""),
});
export type CreateFromLineInput = z.infer<typeof createFromLineSchema>;

/** Rapprochement d'un débit global avec un envoi de virements. */
export const transferLinkSchema = z.object({ lineId: lineIdSchema, batchId: z.string().min(1).max(64) });
export type TransferLinkInput = z.infer<typeof transferLinkSchema>;

/** Rapprochement d'un débit avec une ligne déjà saisie au Débit. */
export const linkExistingSchema = z.object({ lineId: lineIdSchema, invoiceId: z.string().min(1).max(64) });
export type LinkExistingInput = z.infer<typeof linkExistingSchema>;

/** Validation d'un double emploi : lignes détaillées couvertes par un virement global. */
export const doubleEntrySchema = z.object({
  globalId: z.string().min(1).max(64),
  detailIds: z.array(z.string().min(1).max(64)).min(1, "Cochez au moins une ligne.").max(300),
});
export type DoubleEntryInput = z.infer<typeof doubleEntrySchema>;

/** « Ce n'est pas un doublon » pour une paire de virements globaux ou pour un global. */
export const notDoubleSchema = z.object({ ids: z.array(z.string().min(1).max(64)).min(1).max(2) });
export type NotDoubleInput = z.infer<typeof notDoubleSchema>;
