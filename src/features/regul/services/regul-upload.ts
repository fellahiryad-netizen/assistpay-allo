import { regulOptionsSchema, type RegulOptions } from "@/features/regul/schemas";
import type { RegulUpload } from "@/features/regul/services/regul-service";
import { fail, ok, type ActionResult } from "@/types";

const MAX_TOTAL_BYTES = 4 * 1024 * 1024;
const ALLOWED = /\.(xlsx|xlsm|xls|csv)$/i;

/** Extrait et contrôle les fichiers (« files ») et les choix d'un formulaire de régularisation. */
export async function readRegulForm(formData: FormData): Promise<ActionResult<{ files: RegulUpload[]; options: RegulOptions }>> {
  const options = regulOptionsSchema.safeParse({
    succursale: formData.get("succursale"),
    periode: formData.get("periode"),
    annee: formData.get("annee"),
    saisies: formData.get("saisies") ?? undefined,
  });
  if (!options.success) return fail("Choisissez la succursale, la période et l'année.", "VALIDATION");
  const files: RegulUpload[] = [];
  let total = 0;
  for (const entry of formData.getAll("files")) {
    if (!(entry instanceof File) || entry.size === 0) continue;
    if (!ALLOWED.test(entry.name)) return fail(`« ${entry.name} » : utilisez des fichiers Excel (.xlsx, .xls) ou CSV.`, "VALIDATION");
    total += entry.size;
    if (total > MAX_TOTAL_BYTES) return fail("Fichiers trop volumineux (4 Mo au total). Déposez-les en deux fois ou enregistrez-les en CSV.", "VALIDATION");
    files.push({ name: entry.name, bytes: new Uint8Array(await entry.arrayBuffer()) });
  }
  if (!files.length) return fail("Déposez au moins un fichier de production.", "VALIDATION");
  return ok({ files, options: options.data });
}
