import { z } from "zod";
import { INVOICE_STATUS_KEYS, PAYMENT_MODE_KEYS, SENS_KEYS } from "@/features/invoices/types";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date invalide (AAAA-MM-JJ).");
const optionalIsoDate = z
  .union([isoDate, z.literal("")])
  .nullish()
  .transform((value) => (value ? value : null));
const text = (max: number) => z.string().trim().max(max).default("");
const amount = z.coerce
  .number({ invalid_type_error: "Montant invalide." })
  .finite("Montant invalide.")
  .refine((value) => Math.abs(value) < 1e12, "Montant trop élevé.")
  .transform((value) => Math.round(value * 100) / 100);

/** Paramètres d'URL de la liste des factures. */
export const invoiceQuerySchema = z.object({
  sens: z.enum(SENS_KEYS).optional().catch(undefined),
  status: z.enum(INVOICE_STATUS_KEYS).optional().catch(undefined),
  annee: z.coerce.number().int().min(2000).max(2100).optional().catch(undefined),
  categorie: z.string().trim().max(120).optional().catch(undefined),
  q: z.string().trim().max(120).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).default(1).catch(1),
});
export type InvoiceQuery = z.infer<typeof invoiceQuerySchema>;

/** Saisie ou modification d'une facture. */
export const invoiceInputSchema = z
  .object({
    sens: z.enum(SENS_KEYS, { errorMap: () => ({ message: "Choisissez Débit ou Crédit." }) }),
    status: z.enum(INVOICE_STATUS_KEYS).default("EN_ATTENTE"),
    categorie: text(120),
    tiers: z.string().trim().min(1, "Tiers requis.").max(200),
    numero: text(80),
    libelle: text(500),
    montant: amount.refine((value) => value > 0, "Le montant doit être positif."),
    dateFacture: optionalIsoDate,
    dateOperation: optionalIsoDate,
    mode: z
      .union([z.enum(PAYMENT_MODE_KEYS), z.literal("")])
      .nullish()
      .transform((value) => (value ? value : null)),
    cheque: text(80),
    banque: text(80),
    nature: text(120),
    succursale: text(120),
    periode: text(80),
  })
  .superRefine((value, ctx) => {
    if (value.status === "REGLE" && !value.dateOperation) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["dateOperation"], message: "Date de règlement requise pour une facture réglée." });
    }
    if (!value.dateFacture && !value.dateOperation) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["dateFacture"], message: "Indiquez au moins la date de facture." });
    }
  });
export type InvoiceInput = z.infer<typeof invoiceInputSchema>;

/** Identifiant interne d'une facture. */
export const invoiceIdSchema = z.string().min(1).max(64);

/** Enregistrement d'un règlement. */
export const markPaidSchema = z.object({
  id: invoiceIdSchema,
  date: isoDate,
  mode: z.enum(PAYMENT_MODE_KEYS),
  reference: text(80),
  banque: text(80),
});
export type MarkPaidInput = z.infer<typeof markPaidSchema>;

/** Changement d'état simple (remise en attente, annulation). */
export const setStatusSchema = z.object({ id: invoiceIdSchema, status: z.enum(["EN_ATTENTE", "ANNULE"]) });
export type SetStatusInput = z.infer<typeof setStatusSchema>;
