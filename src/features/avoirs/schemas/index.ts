import { z } from "zod";

/** Catégories de motif d'un avoir. */
export const AVOIR_MOTIFS = ["erreur_montant", "annulation", "remise", "doublon", "autre"] as const;

/** Libellés des motifs. */
export const AVOIR_MOTIF_LABELS: Readonly<Record<(typeof AVOIR_MOTIFS)[number], string>> = {
  erreur_montant: "Erreur de montant",
  annulation: "Annulation de la facture",
  remise: "Remise / geste commercial",
  doublon: "Facture en double",
  autre: "Autre motif",
};

/** Création d'un avoir sur une facture établie (la facture d'origine est toujours choisie explicitement). */
export const createAvoirSchema = z
  .object({
    origineId: z.string().min(1, "Choisissez la facture d'origine.").max(64),
    mode: z.enum(["total", "partiel", "manuel"]),
    /** Avoir partiel : TTC réparti comme la facture d'origine. */
    ttc: z.number().positive("Indiquez le montant TTC de l'avoir.").max(1e12).optional(),
    /** Avoir à montant libre : montant saisi, HT (TVA 19 % calculée) ou TTC. */
    saisie: z.enum(["ht", "ttc"]).optional(),
    montant: z.number().positive("Indiquez le montant de l'avoir.").max(1e12).optional(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date invalide.").optional(),
    categorie: z.enum(AVOIR_MOTIFS),
    motif: z.string().trim().min(3, "Le motif est obligatoire (3 caractères au moins).").max(300),
    suite: z.enum(["aucune", "remboursement", "imputation"]).default("aucune"),
  })
  .refine((value) => value.mode !== "partiel" || value.ttc !== undefined, { message: "Indiquez le montant TTC de l'avoir partiel.", path: ["ttc"] })
  .refine((value) => value.mode !== "manuel" || (value.saisie !== undefined && value.montant !== undefined), { message: "Indiquez le montant de l'avoir (HT ou TTC).", path: ["montant"] });
/** Données validées pour créer un avoir. */
export type CreateAvoirInput = z.infer<typeof createAvoirSchema>;

/** Annulation d'un avoir (jamais de suppression : le numéro reste dans la série). */
export const cancelAvoirSchema = z.object({ id: z.string().min(1).max(64), motif: z.string().trim().min(3, "Indiquez le motif de l'annulation.").max(300) });
/** Données validées pour annuler un avoir. */
export type CancelAvoirInput = z.infer<typeof cancelAvoirSchema>;
