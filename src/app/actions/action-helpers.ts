import "server-only";
import type { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import type { AuthUser } from "@/features/access/types";
import { fail, type ActionResult } from "@/types";

/** Premier message d'erreur lisible d'une validation Zod. */
export function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  return issue ? issue.message : "Données invalides.";
}

/**
 * Enveloppe commune des server actions : utilisateur connecté, validation Zod, try/catch.
 * Le service reçoit des données déjà typées et renvoie un ActionResult.
 */
export async function runAction<S extends z.ZodTypeAny, T>(
  schema: S,
  raw: unknown,
  handler: (actor: AuthUser, input: z.output<S>) => Promise<ActionResult<T>>,
): Promise<ActionResult<T>> {
  try {
    const actor = await getCurrentUser();
    if (!actor) return fail("Votre session a expiré, reconnectez-vous.", "UNAUTHENTICATED");
    const parsed = schema.safeParse(raw);
    if (!parsed.success) return fail(firstIssue(parsed.error), "VALIDATION");
    return await handler(actor, parsed.data);
  } catch (error) {
    console.error("[action] erreur inattendue :", error);
    return fail("Une erreur inattendue est survenue.");
  }
}

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const ALLOWED_EXTENSIONS = /\.(xlsx|xlsm|xls|csv)$/i;

/** Fichier Excel/CSV reçu par une server action. */
export interface UploadedSpreadsheet {
  name: string;
  bytes: Uint8Array;
}

/** Extrait et contrôle le fichier « file » d'un formulaire (type, taille). */
export async function readUploadedSpreadsheet(formData: FormData): Promise<ActionResult<UploadedSpreadsheet>> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return fail("Choisissez un fichier.", "VALIDATION");
  if (!ALLOWED_EXTENSIONS.test(file.name)) return fail("Format non pris en charge : utilisez un fichier Excel (.xlsx, .xls) ou CSV.", "VALIDATION");
  if (file.size > MAX_UPLOAD_BYTES) return fail("Fichier trop volumineux (4 Mo maximum).", "VALIDATION");
  return { success: true, data: { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) } };
}

/**
 * Variante de `runAction` pour les formulaires avec fichier : utilisateur connecté, fichier contrôlé, try/catch.
 */
export async function runUploadAction<T>(
  formData: FormData,
  handler: (actor: AuthUser, file: UploadedSpreadsheet) => Promise<ActionResult<T>>,
): Promise<ActionResult<T>> {
  try {
    const actor = await getCurrentUser();
    if (!actor) return fail("Votre session a expiré, reconnectez-vous.", "UNAUTHENTICATED");
    const file = await readUploadedSpreadsheet(formData);
    if (!file.success) return file;
    return await handler(actor, file.data);
  } catch (error) {
    console.error("[action] fichier :", error);
    return fail("Le fichier n'a pas pu être traité.");
  }
}
