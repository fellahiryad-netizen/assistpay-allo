/** Résultat standard des services et des server actions. */
export type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: ErrorCode };

/** Codes d'erreur partagés. */
export type ErrorCode = "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION" | "CONFLICT" | "DATABASE";

/** Construit un résultat de succès. */
export function ok<T>(data: T): ActionResult<T> {
  return { success: true, data };
}

/** Construit un résultat d'échec. */
export function fail<T>(error: string, code?: ErrorCode): ActionResult<T> {
  return code ? { success: false, error, code } : { success: false, error };
}

/** Page de résultats paginée. */
export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}
