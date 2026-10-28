import { z } from "zod";

const productSchema = z.enum(["A", "B"]);

/** Options du contrôle d'un fichier déposé. */
export const uploadCheckSchema = z.object({
  type: z.enum(["A", "B", "auto"]).default("auto"),
  mois: z.string().trim().min(3).max(20),
  annee: z.coerce.number().int().min(2020).max(2100),
});
export type UploadCheckOptions = z.infer<typeof uploadCheckSchema>;

/** Décision sur un envoi. */
export const decideBatchSchema = z.object({
  id: z.string().min(1).max(64),
  statut: z.enum(["valide", "rejete", "attente"]),
  comment: z.string().trim().max(500).default(""),
});
export type DecideBatchInput = z.infer<typeof decideBatchSchema>;

const overrideSchema = z.object({
  rib: z.string().max(30).optional(),
  accountId: z.string().max(64).optional(),
  nom: z.string().trim().max(80).optional(),
  prenom: z.string().trim().max(80).optional(),
  adresse: z.string().trim().max(80).optional(),
});

/** Paramètres de l'état des virements. */
export const sheetSchema = z.object({
  product: productSchema,
  requestIds: z.array(z.string().min(1).max(64)).max(500),
  grouped: z.boolean().default(true),
  overrides: z.record(z.string().max(300), overrideSchema).default({}),
});
export type SheetInput = z.infer<typeof sheetSchema>;

/** Action sur un compte du référentiel RIB. */
export const ribActionSchema = z.object({
  id: z.string().min(1).max(64),
  action: z.enum(["valider", "refuser", "supprimer", "restaurer", "confirmer"]),
  replaceOld: z.boolean().default(false),
});
export type RibActionInput = z.infer<typeof ribActionSchema>;

/** Ajout ou modification manuelle d'un compte. */
export const ribSaveSchema = z.object({
  id: z.string().max(64).optional(),
  rib: z
    .string()
    .transform((value) => value.replace(/\D/g, ""))
    .refine((value) => value.length === 20, "Le RIB doit compter 20 chiffres."),
  noms: z.array(z.string().trim().min(1).max(120)).min(1, "Indiquez au moins un nom.").max(10),
  types: z.array(productSchema).min(1, "Choisissez au moins un produit."),
  wilaya: z.string().trim().max(60).default(""),
  code: z.string().trim().max(20).default(""),
});
export type RibSaveInput = z.infer<typeof ribSaveSchema>;

/** Filtres du référentiel. */
export const ribQuerySchema = z.object({
  filtre: z.enum(["a_valider", "actifs", "supprimes", "tous"]).default("tous").catch("tous"),
  q: z.string().trim().max(120).optional().catch(undefined),
});
export type RibQuery = z.infer<typeof ribQuerySchema>;
