import { z } from "zod";
import { HR_NATURES } from "@/features/hr/types";

/** Filtres de l'écran RH. */
export const hrQuerySchema = z.object({
  annee: z.union([z.literal("all"), z.coerce.number().int().min(2000).max(2100)]).optional(),
  /** « AAAA-MM », ou « nd » pour les écritures sans date de rattachement. */
  mois: z.union([z.string().regex(/^\d{4}-\d{2}$/), z.literal("nd")]).optional().catch(undefined),
  nature: z.string().max(60).optional().catch(undefined),
  /** Groupe de natures (clic sur un total) : salaires, CNAS / CASNOS, G50 / IRG, autres. */
  groupe: z.enum(["sal", "cnas", "g50", "autre"]).optional().catch(undefined),
  q: z.string().trim().max(100).optional().catch(undefined),
  /** « tout » : affiche toutes les anomalies (sinon les 60 premières). */
  anomalies: z.literal("tout").optional().catch(undefined),
  /** « verifier » : seulement les paiements par chèque ou virement non rapprochés avec certitude du relevé (probables ou non trouvés). */
  releve: z.literal("verifier").optional().catch(undefined),
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
    /** Passe outre un doublon PROBABLE (jamais un doublon certain). */
    confirmerDoublon: z.boolean().default(false),
  })
  .refine((value) => value.mode !== "CHEQUE" || value.cheque.length > 0, { message: "Saisissez le numéro du chèque.", path: ["cheque"] });
/** Écriture RH validée. */
export type HrEntryInput = z.infer<typeof hrEntrySchema>;

/** Suppression d'une écriture RH. */
export const hrDeleteSchema = z.object({ id: z.string().min(1).max(64) });

/** Validation d'une anomalie RH : clé stable et motif facultatif. */
export const hrAnomalyValidateSchema = z.object({ key: z.string().min(1).max(400), motif: z.string().trim().max(200).default("") });

/** Rétablissement d'une anomalie validée. */
export const hrAnomalyRestoreSchema = z.object({ key: z.string().min(1).max(400) });

/** Validation en bloc d'anomalies RH : clés stables et un seul motif facultatif. */
export const hrAnomaliesValidateSchema = z.object({ keys: z.array(z.string().min(1).max(400)).min(1).max(500), motif: z.string().trim().max(200).default("") });
/** Validation en bloc reçue par le service. */
export type HrAnomaliesValidateInput = z.infer<typeof hrAnomaliesValidateSchema>;

/** Détail d'une écriture RH (fenêtre dynamique). */
export const hrDetailSchema = z.object({ id: z.string().min(1).max(64) });

/** Affectation d'une écriture RH à une ligne du relevé, avec les corrections facultatives demandées. */
export const hrAssignSchema = z.object({
  id: z.string().min(1).max(64),
  lineId: z.string().min(1).max(64),
  /** Remplace le montant de l'écriture par celui du relevé. */
  alignerMontant: z.boolean().default(false),
  /** Remplace la date de paiement par celle du relevé (sinon seulement si elle est vide). */
  alignerDate: z.boolean().default(false),
});
/** Affectation validée. */
export type HrAssignInput = z.infer<typeof hrAssignSchema>;
