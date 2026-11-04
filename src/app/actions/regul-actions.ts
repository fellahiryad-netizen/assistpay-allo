"use server";

import { readRegulForm } from "@/features/regul/services/regul-upload";
import { runRegul, type RegulResult } from "@/features/regul/services/regul-service";
import { getCurrentUser } from "@/lib/auth";
import { fail, type ActionResult } from "@/types";

/** Calcule la régularisation 10 % + TVA d'une succursale à partir des fichiers déposés (rien n'est enregistré). */
export async function analyseRegulAction(formData: FormData): Promise<ActionResult<RegulResult>> {
  try {
    const actor = await getCurrentUser();
    if (!actor) return fail("Votre session a expiré, reconnectez-vous.", "UNAUTHENTICATED");
    const form = await readRegulForm(formData);
    if (!form.success) return form;
    return await runRegul(actor, form.data.files, form.data.options);
  } catch (error) {
    console.error("[regul] analyse :", error);
    return fail("Les fichiers n'ont pas pu être traités.");
  }
}
