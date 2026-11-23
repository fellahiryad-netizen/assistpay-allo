import type { ZodError } from "zod";

/** Première erreur de chaque champ d'un formulaire validé par Zod, indexée par nom de champ. */
export function fieldErrors(error: ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "");
    if (key && !(key in result)) result[key] = issue.message;
  }
  return result;
}
