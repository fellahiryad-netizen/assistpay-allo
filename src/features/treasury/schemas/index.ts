import { z } from "zod";
import { SIM_CERTAINTIES, SIM_MODES, SIM_TYPES } from "@/features/treasury/types";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date invalide.");
const id = z.string().min(1).max(80);

/** Ligne de simulation saisie par la comptable. */
export const simLineSchema = z.object({
  scenarioId: id,
  type: z.enum(SIM_TYPES),
  libelle: z.string().trim().min(1, "Indiquez un libellé.").max(120, "Libellé trop long (120 caractères)."),
  periode: z.union([z.literal(""), z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Période invalide (AAAA-MM).")]),
  montant: z.number({ invalid_type_error: "Indiquez un montant." }).finite().positive("Le montant doit être supérieur à zéro."),
  date: isoDate,
  mode: z.enum(SIM_MODES),
  certitude: z.enum(SIM_CERTAINTIES),
  /** Confirmation explicite d'un montant supérieur à 100 000 000 DA. */
  confirmer: z.boolean().optional(),
});
export type SimLineInput = z.infer<typeof simLineSchema>;

/** Modification d'une ligne existante. */
export const simLineUpdateSchema = simLineSchema.extend({ lineId: id });
export type SimLineUpdateInput = z.infer<typeof simLineUpdateSchema>;

/** Création d'un scénario. */
export const scenarioCreateSchema = z.object({ nom: z.string().trim().min(1, "Donnez un nom au scénario.").max(80, "Nom trop long (80 caractères).") });
export type ScenarioCreateInput = z.infer<typeof scenarioCreateSchema>;

/** Duplication d'un scénario. */
export const scenarioDuplicateSchema = z.object({ scenarioId: id, nom: z.string().trim().min(1, "Donnez un nom à la copie.").max(80, "Nom trop long (80 caractères).") });
export type ScenarioDuplicateInput = z.infer<typeof scenarioDuplicateSchema>;

/** Action sur un scénario existant (activer, supprimer, vider). */
export const scenarioIdSchema = z.object({ scenarioId: id });
export type ScenarioIdInput = z.infer<typeof scenarioIdSchema>;

/** Activation d'un scénario, ou retour à la situation réelle (null). */
export const scenarioActivateSchema = z.object({ scenarioId: id.nullable() });
export type ScenarioActivateInput = z.infer<typeof scenarioActivateSchema>;

/** Suppression d'une ligne. */
export const lineIdSchema = z.object({ scenarioId: id, lineId: id });
export type LineIdInput = z.infer<typeof lineIdSchema>;

/** Décision sur un doublon signalé. */
export const lineDecisionSchema = z.object({ scenarioId: id, lineId: id, decision: z.enum(["ignorer", "garder"]).nullable() });
export type LineDecisionInput = z.infer<typeof lineDecisionSchema>;

/** Réglages de la trésorerie (administrateur ou direction). */
export const treasurySettingsSchema = z.object({
  minimumMode: z.enum(["montant", "jours"]),
  minimumMontant: z.number({ invalid_type_error: "Indiquez le minimum de trésorerie." }).finite().positive("Le minimum de trésorerie doit être supérieur à zéro.").max(100_000_000_000, "Minimum trop grand."),
  coussinJours: z.union([z.literal(7), z.literal(15), z.literal(30)]),
  encaissementsAttendus: z.boolean(),
});
export type TreasurySettingsInput = z.infer<typeof treasurySettingsSchema>;

/** Solde saisi à la main (secours). */
export const manualBalanceSchema = z.object({
  balance: z.number({ invalid_type_error: "Indiquez le solde." }).finite().min(-1_000_000_000_000).max(1_000_000_000_000),
  date: isoDate,
  source: z.string().trim().min(3, "Indiquez la source (par exemple « relevé AGB du 22/11/2026 »).").max(120),
});
export type ManualBalanceInput = z.infer<typeof manualBalanceSchema>;

/** Paramètres de la page : inclure ou non les demandes sans facture liée. */
export const treasuryQuerySchema = z.object({ demandes: z.boolean() });
export type TreasuryQuery = z.infer<typeof treasuryQuerySchema>;
