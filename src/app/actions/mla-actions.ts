"use server";

import { z } from "zod";
import { runAction } from "@/app/actions/action-helpers";
import { saveMlaDraft } from "@/features/mla/services/mla-store";
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
