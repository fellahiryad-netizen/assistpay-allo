import { z } from "zod";
import { cleanPersonName, cleanPhones, cleanText } from "@/features/courrier/lib/clean";
import { COURRIER_COMPANIES, EMS_ROLES } from "@/features/courrier/types";

/** Texte nettoyé (espaces, insécables), avec une longueur maximale. */
const text = (max: number, tooLong: string) =>
  z.string({ invalid_type_error: "Texte attendu." }).max(max * 2, tooLong).transform(cleanText).refine((value) => value.length <= max, tooLong);

/** Texte nettoyé et obligatoire. */
const required = (max: number, missing: string, tooLong: string) =>
  text(max, tooLong).refine((value) => value.length > 0, missing);

/** Numéros facultatifs : au moins un chiffre s'il y a du texte. */
const phones = (missing: string) =>
  z
    .string({ invalid_type_error: "Texte attendu." })
    .max(240, "Téléphone trop long (120 caractères au plus).")
    .transform(cleanPhones)
    .refine((value) => value.length <= 120, "Téléphone trop long (120 caractères au plus).")
    .refine((value) => value === "" || /\d/.test(value), missing);

const id = z.string().min(1).max(64).optional();

/** Fiche d'une succursale (ajout si `id` est absent, modification sinon). */
export const branchSchema = z.object({
  id,
  compagnie: z.enum(COURRIER_COMPANIES, { errorMap: () => ({ message: "Choisissez la compagnie (CAAR ou CAAT)." }) }),
  nom: required(120, "Indiquez le nom de la succursale.", "Nom trop long (120 caractères au plus)."),
  contact: z.string({ invalid_type_error: "Texte attendu." }).max(240, "Nom du contact trop long (120 caractères au plus).").transform(cleanPersonName).refine((value) => value.length <= 120, "Nom du contact trop long (120 caractères au plus)."),
  telephones: phones("Le téléphone doit contenir des chiffres."),
  adresse: required(200, "Indiquez l'adresse.", "Adresse trop longue (200 caractères au plus)."),
  remarque: text(300, "Remarque trop longue (300 caractères au plus)."),
});
/** Fiche de succursale validée. */
export type BranchInput = z.infer<typeof branchSchema>;
/** Fiche de succursale telle que saisie, avant validation. */
export type BranchFormValues = z.input<typeof branchSchema>;

/** Personne du prestataire de courrier. */
export const emsContactSchema = z.object({
  id,
  nom: required(120, "Indiquez le nom de la personne.", "Nom trop long (120 caractères au plus)."),
  role: z.enum(EMS_ROLES, { errorMap: () => ({ message: "Choisissez le rôle (ramasseur ou réclamations)." }) }),
  telephone: phones("Le téléphone doit contenir des chiffres.").refine((value) => value.length > 0, "Indiquez le téléphone."),
  email: z
    .string({ invalid_type_error: "Texte attendu." })
    .max(240, "Adresse e-mail trop longue.")
    .transform((value) => cleanText(value).toLowerCase())
    .refine((value) => value === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value), "Adresse e-mail invalide (exemple : nom@societe.dz)."),
  remarque: text(300, "Remarque trop longue (300 caractères au plus)."),
});
/** Personne du prestataire validée. */
export type EmsContactInput = z.infer<typeof emsContactSchema>;
/** Personne du prestataire telle que saisie, avant validation. */
export type EmsContactFormValues = z.input<typeof emsContactSchema>;

/** Nom de la société de courrier. */
export const emsSocieteSchema = z.object({ nom: required(80, "Indiquez le nom de la société.", "Nom trop long (80 caractères au plus).") });
/** Nom de société validé. */
export type EmsSocieteInput = z.infer<typeof emsSocieteSchema>;

/** Suppression d'une fiche. */
export const deleteFicheSchema = z.object({ id: z.string().min(1, "Fiche introuvable.").max(64) });
/** Suppression validée. */
export type DeleteFicheInput = z.infer<typeof deleteFicheSchema>;

/** Paramètres de la page d'impression : identifiants séparés par des virgules (200 au plus). */
export const envelopeQuerySchema = z.object({
  ids: z
    .string()
    .max(200 * 65)
    .transform((value) => [...new Set(value.split(",").map((part) => part.trim()).filter((part) => part.length > 0))])
    .refine((list) => list.length > 0 && list.length <= 200 && list.every((item) => item.length <= 64), "Choisissez au moins une succursale."),
});
/** Paramètres d'impression validés. */
export type EnvelopeQuery = z.infer<typeof envelopeQuerySchema>;
