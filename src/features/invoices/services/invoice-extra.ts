import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";

const loose = <T extends z.ZodTypeAny>(schema: T) => schema.optional().catch(undefined);

/** Paiement partiel enregistré sur une facture. */
export interface PartialPayment {
  date: string;
  montant: number;
  type: string;
  numero: string;
}

const paymentSchema = z.object({
  date: z.coerce.string().default(""),
  montant: z.coerce.number().finite(),
  type: z.coerce.string().default(""),
  numero: z.coerce.string().default(""),
});

/**
 * Champs complémentaires d'une facture, conservés en JSON (`Invoice.extra`) :
 * paiements partiels, règlement séparé des débours et des frais (BDG), groupe de règlement, envoi de virements…
 */
export const invoiceExtraSchema = z
  .object({
    paiements: loose(z.array(paymentSchema)),
    regDebours: loose(z.union([z.string(), z.boolean()])),
    regFrais: loose(z.union([z.string(), z.boolean()])),
    factureDebours: loose(z.string()),
    factureFrais: loose(z.string()),
    groupe: loose(z.object({ id: z.coerce.string(), montant: z.coerce.number() }).passthrough()),
    inclusDans: loose(z.union([z.string(), z.array(z.string())])),
    detail: loose(z.array(z.string())),
    global: loose(z.boolean()),
    envoi: loose(z.string()),
    refPaiement: loose(z.string()),
    dblOk: loose(z.boolean()),
    dblOkWith: loose(z.array(z.string())),
  })
  .passthrough();

/** Champs complémentaires lus. */
export type InvoiceExtra = z.infer<typeof invoiceExtraSchema>;

/** Lit le JSON `extra` sans jamais échouer (valeurs invalides ignorées). */
export function readExtra(extra: Prisma.JsonValue): InvoiceExtra {
  const parsed = invoiceExtraSchema.safeParse(extra && typeof extra === "object" && !Array.isArray(extra) ? extra : {});
  return parsed.success ? parsed.data : {};
}

/** Prépare un objet `extra` pour l'écriture en base. */
export function writeExtra(extra: InvoiceExtra): Prisma.InputJsonObject {
  return JSON.parse(JSON.stringify(extra)) as Prisma.InputJsonObject;
}
