"use server";

import { z } from "zod";
import { runAction } from "@/app/actions/action-helpers";
import { CAAR_SUCCURSALES } from "@/features/caar-regul/services/caar-regul-engine";
import {
  caarRegulOverview,
  caarRegulWorkData,
  saveCaarAvance,
  saveCaarBase,
  saveCaarIndex,
  saveCaarResults,
  saveCaarSinistres,
  type CaarRegulOverview,
  type CaarRegulWorkData,
} from "@/features/caar-regul/services/caar-regul-store";
import type { ActionResult } from "@/types";

const succ = z.enum(CAAR_SUCCURSALES);
const num = z.number().finite();
const ymCode = z.number().int().min(202605).max(209912);
const key = z.string().regex(/^[A-Z]+-\d{4}-\d{2}$/);

/** Index de la base, résumé de la base activité et résultats enregistrés. */
export async function caarRegulOverviewAction(): Promise<ActionResult<CaarRegulOverview>> {
  return runAction(z.object({}), {}, (actor) => caarRegulOverview(actor));
}

/** Production des mois demandés, base activité et avances saisies d'une succursale. */
export async function caarRegulWorkDataAction(input: { succursale: string; months: number[] }): Promise<ActionResult<CaarRegulWorkData>> {
  return runAction(z.object({ succursale: succ, months: z.array(ymCode).max(12) }), input, (actor, d) => caarRegulWorkData(actor, d.succursale, d.months));
}

/** Enregistre l'avance HT d'un mois saisie à la main. */
export async function saveCaarAvanceAction(input: { key: string; succursale: string; avance: number }): Promise<ActionResult<true>> {
  return runAction(z.object({ key, succursale: succ, avance: num }), input, (actor, d) => saveCaarAvance(actor, d.key, d.succursale, d.avance));
}

/** Enregistre le résultat d'une régularisation dans le suivi. */
export async function saveCaarResultsAction(input: { resume: string; results: Array<Record<string, unknown>> }): Promise<ActionResult<true>> {
  const schema = z.object({
    resume: z.string().max(300),
    results: z
      .array(
        z.object({
          key,
          succ,
          ym: ymCode,
          annee: z.number().int(),
          mois: z.number().int().min(1).max(12),
          total: num,
          avance: num,
          regule: num,
          ecart: num,
          tva: num,
          pa: num,
          fact: z.string().max(60),
          top: z.string().max(500),
          fichiers: z.array(z.string().max(250)).max(40),
          maj: z.string().max(20),
        }),
      )
      .max(12),
  });
  return runAction(schema, input, (actor, d) => saveCaarResults(actor, d.results, d.resume));
}

/** Remplace la production d'une succursale pour un mois (administrateur). */
export async function saveCaarBaseAction(input: { succursale: string; ym: number; rows: unknown[] }): Promise<ActionResult<true>> {
  const row = z.tuple([ymCode, z.string().max(20), z.string().max(200), z.string().max(40), z.string().max(12), z.string().max(60), z.number().int().min(0), z.number().int().min(0).max(1), num, num, num, z.number().int().min(0).max(3)]);
  return runAction(z.object({ succursale: succ, ym: ymCode, rows: z.array(row).max(30000) }), input, (actor, d) => saveCaarBase(actor, d.succursale, d.ym, d.rows));
}

/** Remplace l'index après le dépôt du consolidé (administrateur). */
export async function saveCaarIndexAction(input: Record<string, unknown>): Promise<ActionResult<true>> {
  const schema = z.object({
    forms: z.array(z.string().max(200)).max(2000),
    mois: z.record(z.string(), z.record(z.string(), z.object({ n: z.number().int(), nIncl: z.number().int(), allo: num, p90: num }))),
    factures: z.record(z.string(), z.record(z.string(), z.object({ fact: z.string().max(60), ttc: num, date: z.string().max(20), etat: z.string().max(60) }))),
    lignes: z.record(z.string(), z.number().int()),
    source: z.string().max(200),
    total: z.number().int(),
  });
  return runAction(schema, input, (actor, d) => saveCaarIndex(actor, d));
}

/** Remplace la base activité (administrateur). */
export async function saveCaarSinistresAction(input: { keys: string[]; jusqua: string; dossiers: number }): Promise<ActionResult<true>> {
  return runAction(z.object({ keys: z.array(z.string().max(120)).max(300000), jusqua: z.string().max(12), dossiers: z.number().int() }), input, (actor, d) => saveCaarSinistres(actor, d));
}
