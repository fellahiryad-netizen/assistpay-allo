import { requireAccess } from "@/features/access/services/access-rules";
import type { AuthUser } from "@/features/access/types";
import { buildPolicesSheets } from "@/features/regul/services/regul-polices-sheets";
import type { PolicesQuery } from "@/features/regul/services/regul-polices";
import { regulPolices } from "@/features/regul/services/regul-polices-store";
import { writeTableWorkbook } from "@/lib/spreadsheet";
import { fail, ok, type ActionResult } from "@/types";
import { todayIso } from "@/utils/dates";

/** Classeur Excel des polices non retrouvées, annulées et sinistrées (impression noir et blanc, paysage). */
export async function exportRegulPolices(actor: AuthUser, query: PolicesQuery): Promise<ActionResult<{ bytes: Uint8Array; name: string }>> {
  const guard = requireAccess(actor, "A_EXPORT", "EDIT");
  if (!guard.success) return guard;
  const view = await regulPolices(actor, query);
  if (!view.success) return view;
  if (!view.data.blocks.length) return fail("Aucune régularisation conservée pour cette sélection : rechargez les fichiers de régularisation.", "NOT_FOUND");
  try {
    const bytes = await writeTableWorkbook(buildPolicesSheets(view.data));
    const scope = query.succ ? query.succ.replace(/ /g, "") : "TOUTES";
    return ok({ bytes, name: `Polices_regul_CAAT_${scope}_${todayIso()}.xlsx` });
  } catch (error) {
    console.error("[regul] export polices :", error);
    return fail("Le classeur n'a pas pu être créé.");
  }
}
