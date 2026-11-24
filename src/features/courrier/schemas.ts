import { z } from "zod";
import { cleanPersonName, cleanPhones, cleanText } from "@/features/courrier/lib/clean";
import { COURRIER_COMPANIES, EMS_ROLES, type BordereauLine } from "@/features/courrier/types";

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
  destination: text(120, "Destination trop longue (120 caractères au plus).").default(""),
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

/** Plafond de lignes d'un bordereau. */
export const MAX_BORDEREAU_LINES = 60;

/** Date `AAAA-MM-JJ` réelle (le 31 février est refusée). */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date invalide.")
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, "Date invalide.");

/** Paramètre répété de l'adresse : une valeur seule devient une liste, l'absence donne une liste vide. */
const repeated = <T extends z.ZodTypeAny>(item: T) =>
  z.preprocess((value) => (Array.isArray(value) ? value : value === undefined ? [] : [value]), z.array(item).min(1, "Ajoutez au moins une ligne.").max(MAX_BORDEREAU_LINES, `Pas plus de ${MAX_BORDEREAU_LINES} lignes.`));

/**
 * Paramètres de la page d'impression du bordereau : date, cachet, et quatre listes de même longueur
 * (désignation, quantité, destination, observation). Les textes sont nettoyés et plafonnés.
 */
export const bordereauQuerySchema = z
  .object({
    date: isoDate,
    cachet: z.enum(["0", "1"]).default("1").transform((value) => value === "1"),
    des: repeated(text(120, "Désignation trop longue (120 caractères au plus).").refine((value) => value.length > 0, "Chaque ligne a besoin d'une désignation.")),
    qnt: repeated(z.coerce.number({ invalid_type_error: "La quantité doit être un nombre." }).int("La quantité doit être un nombre entier.").min(1, "La quantité doit être au moins 1.").max(9999, "Quantité trop grande.")),
    dst: repeated(text(120, "Destination trop longue (120 caractères au plus).")),
    /** Nom du ramasseur EMS (contact choisi ou remplaçant saisi) ; vide : ligne à remplir à la main. */
    ram: text(80, "Nom du ramasseur trop long (80 caractères au plus).").default(""),
    obs: repeated(text(160, "Observation trop longue (160 caractères au plus).")),
  })
  .refine((value) => value.des.length === value.qnt.length && value.des.length === value.dst.length && value.des.length === value.obs.length, { message: "Les lignes du bordereau sont incomplètes." });
/** Paramètres validés du bordereau (listes de même longueur). */
export type BordereauQuery = z.infer<typeof bordereauQuerySchema>;

/** Lignes d'un bordereau validé. */
export function bordereauLinesOf(query: BordereauQuery): BordereauLine[] {
  return query.des.map((designation, index) => ({ designation, qnt: query.qnt[index] ?? 1, destination: query.dst[index] ?? "", observation: query.obs[index] ?? "" }));
}
