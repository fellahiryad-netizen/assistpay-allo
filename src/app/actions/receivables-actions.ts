"use server";

import { runAction } from "@/app/actions/action-helpers";
import type { ImpayesMail } from "@/features/receivables/lib/report-mail";
import { impayesMailSchema, type ImpayesMailInput } from "@/features/receivables/schemas";
import { prepareImpayesMail } from "@/features/receivables/services/receivables-report";
import type { ActionResult } from "@/types";

/** Mail préparé pour la direction d'une compagnie (succursales en retard et mois en retard). */
export async function impayesMailAction(input: ImpayesMailInput): Promise<ActionResult<ImpayesMail>> {
  return runAction(impayesMailSchema, input, prepareImpayesMail);
}
