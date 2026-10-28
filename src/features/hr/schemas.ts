import { z } from "zod";
import { HR_NATURES } from "@/features/hr/types";

/** Filtres de l'écran RH. */
export const hrQuerySchema = z.object({
  annee: z.union([z.literal("all"), z.coerce.number().int().min(2000).max(2100)]).optional(),
  mois: z.string().regex(/^\d{4}-\d{2}$/).optional().catch(undefined),
  nature: z.string().max(60).optional().catch(undefined),
  q: z.string().trim().max(100).optional().catch(undefined),
});
/** Filtres validés. */
export type HrQuery = z.infer<typeof hrQuerySchema>;

/** Saisie ou modification d'une écriture RH. */
export const hrEntrySchema = z
  .object({
    id: z.string().max(64).optional(),
    nature: z.enum(HR_NATURES, { errorMap: () => ({ message: "Choisissez la nature." }) }),
    sens: z.enum(["PAIEMENT", "RETOUR"]),
    beneficiaire: z.string().trim().min(1, "Indiquez l'employé ou l'organisme.").max(160),
    mois: z.string().regex(/^\d{4}-\d{2}$/, "Indiquez le mois concerné."),
    date: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal("")]),
    montant: z.coerce.number({ invalid_type_error: "Saisissez un montant en chiffres." }).positive("Saisissez un montant supérieur à zéro.").max(1_000_000_000),
    mode: z.enum(["VIRMT", "CHEQUE", ""]),
    cheque: z.string().trim().max(40),
    banque: z.string().trim().max(60),
    libelle: z.string().trim().max(300),
  })
  .refine((value) => value.mode !== "CHEQUE" || value.cheque.length > 0, { message: "Saisissez le numéro du chèque.", path: ["cheque"] });
/** Écriture RH validée. */
export type HrEntryInput = z.infer<typeof hrEntrySchema>;

/** Suppression d'une écriture RH. */
export const hrDeleteSchema = z.object({ id: z.string().min(1).max(64) });
