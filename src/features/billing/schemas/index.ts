import { z } from "zod";

const text = (max: number) => z.string().max(max).default("");

/** Facture saisie dans l'éditeur. */
export const billingDraftSchema = z.object({
  preset: z.string().min(1).max(40),
  client: z.string().min(1).max(20),
  cli: z.object({ nom: text(200), adresse: text(300), tel: text(100), rc: text(60), nif: text(60), nis: text(60), ai: text(60) }),
  num: text(60),
  num2: text(60),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Indiquez la date de facture."),
  objet: text(200),
  per: z.union([z.string().regex(/^\d{4}-\d{2}$/), z.literal("")]),
  perTxt: text(120),
  succ: text(80),
  bc: text(80),
  origine: text(120),
  destination: text(120),
  details: z.record(z.string().max(40), z.string().max(200)).default({}),
  notes: text(2000),
  rows: z.array(z.record(z.string().max(20), z.string().max(400))).min(1).max(2000),
  bdgType: z.enum(["pair", "deb", "fra"]).default("pair"),
  caarProd: text(64),
  fromPrev: text(80),
  emAi: text(60).optional(),
});

/** Enregistrement d'une facture (création, ou rectification d'une facture émise avec motif). */
export const saveBillingSchema = z.object({
  draft: billingDraftSchema,
  issuedId: z.string().max(64).optional(),
  motif: z.string().trim().max(300).optional(),
});
export type SaveBillingInput = z.infer<typeof saveBillingSchema>;

/** Préparation d'une nouvelle facture. */
export const prepareBillingSchema = z.object({
  preset: z.string().min(1).max(40),
  client: z.string().max(20).optional(),
  bdgType: z.enum(["pair", "deb", "fra"]).optional(),
  duplicateOf: z.string().max(64).optional(),
  caarId: z.string().max(64).optional(),
});
export type PrepareBillingInput = z.infer<typeof prepareBillingSchema>;
