"use server";

import { z } from "zod";
import { runAction } from "@/app/actions/action-helpers";
import { REGUL_SUCCURSALES } from "@/features/regul/services/regul-engine";
import { saveFichiers, type FichiersSaved } from "@/features/regul/services/regul-polices-store";
import type { RegulFichier } from "@/features/regul/services/regul-polices";
import { regulOverview, regulWorkData, saveBase, saveIndex, saveResults, saveSaisie, saveSinistres, type RegulOverview, type RegulWorkData } from "@/features/regul/services/regul-store";
import { fail, type ActionResult } from "@/types";

const succ = z.enum(REGUL_SUCCURSALES);
const num = z.number().finite();
const fait = z.object({
  total: num,
  avance: num,
  regule: num,
  ecart: num,
  tva: num,
  pa: num,
  releve: num.nullable().optional(),
  statut: z.string().max(200).optional(),
  src: z.string().max(40).optional(),
  base: num.nullable().optional(),
  top: z.string().max(500).optional(),
});

/** Index de la base, résumé sinistres et résultats enregistrés. */
export async function regulOverviewAction(): Promise<ActionResult<RegulOverview>> {
  return runAction(z.object({}), {}, (actor) => regulOverview(actor));
}

/** Production, base sinistres et saisies d'une succursale. */
export async function regulWorkDataAction(input: { succursale: string }): Promise<ActionResult<RegulWorkData>> {
  return runAction(z.object({ succursale: succ }), input, (actor, data) => regulWorkData(actor, data.succursale));
}

/** Enregistre un total ou une avance saisi à la main. */
export async function saveSaisieAction(input: { key: string; succursale: string; field: "total" | "avance"; value: number }): Promise<ActionResult<true>> {
  return runAction(z.object({ key: z.string().regex(/^[A-Z_]+-\d{4}-\d{2}$/), succursale: succ, field: z.enum(["total", "avance"]), value: num }), input, (actor, d) => saveSaisie(actor, d.key, d.succursale, d.field, d.value));
}

/** Enregistre le résultat d'une régularisation dans le suivi. */
export async function saveResultsAction(input: { resume: string; results: Array<Record<string, unknown>> }): Promise<ActionResult<true>> {
  const schema = z.object({
    resume: z.string().max(300),
    results: z
      .array(z.object({ key: z.string().regex(/^[A-Z_]+-\d{4}-\d{2}$/), succ, mois: z.number().int().min(1).max(12), annee: z.number().int(), total: num, avance: num, regule: num, ecart: num, tva: num, pa: num, base: num, top: z.string().max(500), fichiers: z.array(z.string().max(200)).max(40), maj: z.string().max(20) }))
      .max(12),
  });
  return runAction(schema, input, (actor, d) => saveResults(actor, d.results, d.resume));
}

/** Remplace la production d'une succursale (administrateur). */
export async function saveBaseAction(input: { succursale: string; rows: unknown[] }): Promise<ActionResult<true>> {
  const row = z.tuple([z.number().int(), z.number().int(), z.string().max(80), z.string().max(80), z.number().int().min(-1).max(20), num, num]);
  return runAction(z.object({ succursale: succ, rows: z.array(row).max(60000) }), input, (actor, d) => saveBase(actor, d.succursale, d.rows));
}

/** Fusionne TCD, historique et totaux dans l'index (administrateur). */
export async function saveIndexAction(input: Record<string, unknown>): Promise<ActionResult<true>> {
  const months = z.record(z.string(), z.record(z.string(), z.object({ total: num, avance: num, statut: z.string().max(200) })));
  const schema = z.object({
    lignes: z.record(z.string(), z.number().int()),
    tcd: months,
    hist: z.record(z.string(), z.record(z.string(), fait)),
    baseMois: z.record(z.string(), z.record(z.string(), num)),
    agences: z.record(z.string(), z.string().max(200)),
    source: z.string().max(200),
    total: z.number().int(),
  });
  return runAction(schema, input, (actor, d) => saveIndex(actor, d));
}

/** Remplace la base sinistres (administrateur). */
export async function saveSinistresAction(input: { keys: string[]; jusqua: string; dossiers: number }): Promise<ActionResult<true>> {
  return runAction(z.object({ keys: z.array(z.string().max(120)).max(200000), jusqua: z.string().max(12), dossiers: z.number().int() }), input, (actor, d) => saveSinistres(actor, d));
}

/**
 * Conserve les polices du fichier de régularisation analysé (un mois). Fusion par nom de fichier avec l'enregistrement du mois :
 * les fichiers rechargés sont remplacés, les autres conservés. `suite` : lot suivant d'un même chargement (envoi découpé en lots).
 */
export async function saveFichierAction(input: { succursale: string; fichier: RegulFichier; suite?: boolean }): Promise<ActionResult<FichiersSaved>> {
  const row = z.tuple([z.number().int().min(0), z.string().max(80), z.string().max(80), z.number().int().min(0).max(60), num, z.union([z.literal(0), z.literal(1), z.literal(2)])]);
  const fichier = z
    .object({
      succ,
      mois: z.number().int().min(1).max(12),
      annee: z.number().int().min(2020).max(2100),
      maj: z.string().max(20),
      fichiers: z.array(z.string().max(200)).max(40),
      agences: z.record(z.string(), z.string().max(200)),
      produits: z.array(z.string().max(80)).max(60),
      rows: z.array(row).max(30000),
      origine: z.array(z.number().int().min(0).max(40)).max(30000).optional(),
    })
    .refine((f) => !f.origine || f.origine.length === f.rows.length, { message: "Origine des lignes incohérente." });
  return runAction(z.object({ succursale: succ, fichier, suite: z.boolean().optional() }), input, (actor, d) =>
    d.fichier.succ !== d.succursale ? Promise.resolve(fail<FichiersSaved>("Succursale incohérente.", "VALIDATION")) : saveFichiers(actor, [d.fichier], { suite: d.suite }),
  );
}
