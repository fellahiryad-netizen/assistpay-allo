"use server";

import { z } from "zod";
import { runAction } from "@/app/actions/action-helpers";
import { prepareDraft, saveDraft } from "@/features/billing/services/billing-service";
import { logAction } from "@/features/journal/services/journal-service";
import { saveMlaDraft, saveMlaParams } from "@/features/mla/services/mla-store";
import { fail, ok } from "@/types";
import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/types";

const schema = z.object({
  rows: z.array(z.record(z.string(), z.string().max(160))).min(2).max(400),
  per: z.string().regex(/^\d{4}-\d{2}$/),
  perTxt: z.string().max(80),
  notes: z.string().max(400).default(""),
});

/** Transmet le calcul MLA à l'éditeur de facture ; renvoie l'identifiant du brouillon. */
export async function mlaPrepareAction(input: z.input<typeof schema>): Promise<ActionResult<{ token: string }>> {
  return runAction(schema, input, saveMlaDraft);
}

/** Établit directement la facture MLA : calcul → brouillon → enregistrement ; renvoie la facture émise prête à imprimer. */
export async function mlaEstablishAction(input: z.input<typeof schema>): Promise<ActionResult<{ id: string; num: string; ttc: number }>> {
  const result = await runAction(schema, input, async (actor, value): Promise<ActionResult<{ id: string; num: string; ttc: number }>> => {
    const saved = await saveMlaDraft(actor, value);
    if (!saved.success) return saved;
    const draft = await prepareDraft(actor, { preset: "m_mla", mla: saved.data.token });
    if (!draft.success) return draft;
    if (!draft.data.num.trim()) return fail("Aucun numéro de facture n'a pu être proposé : ouvrez la facture dans l'éditeur pour le saisir.", "VALIDATION");
    const issued = await saveDraft(actor, { draft: draft.data });
    if (!issued.success) return issued;
    const retraits = value.rows.slice(2).filter((row) => !row.info && row.des).map((row) => row.des);
    await logAction(
      actor,
      "Facture MLA établie",
      `${draft.data.num} – ${value.perTxt} – ${value.rows[0]?.qte ?? "?"} véhicules – ${retraits.length} retrait(s) sinistré(s)${retraits.length ? ` (${retraits.join(", ")})` : ""} – ${issued.data.ttc} DA TTC`,
    );
    return ok({ id: issued.data.id, num: draft.data.num, ttc: issued.data.ttc });
  });
  if (result.success) {
    revalidatePath("/facturation");
    revalidatePath("/factures");
  }
  return result;
}

const paramsSchema = z.object({ primeAnnuelle: z.coerce.number().positive().max(10_000_000), primeRetraitMois: z.coerce.number().positive().max(10_000_000) });

/** Modifie les primes MLA (administrateurs). */
export async function mlaSaveParamsAction(input: z.input<typeof paramsSchema>): Promise<ActionResult<{ primeAnnuelle: number; primeRetraitMois: number }>> {
  const result = await runAction(paramsSchema, input, saveMlaParams);
  if (result.success) revalidatePath("/mla");
  return result;
}
