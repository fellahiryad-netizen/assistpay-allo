import type { ReceivablesQuery } from "@/features/receivables/schemas";

/**
 * Lien vers la liste des factures partenaires en attente d'une compagnie.
 * Une seule catégorie brute : filtre exact `categorie` ; plusieurs (ex. CAAT + BDG CAAT) : recherche `q` sur le nom de la compagnie.
 * Sans compagnie (`null`) : toutes les créances. L'année de la page est reprise.
 */
export function invoicesHref(company: string | null, categories: readonly string[], query: ReceivablesQuery): string {
  const params = new URLSearchParams({ sens: "CREDIT", status: "EN_ATTENTE" });
  if (query.annee) params.set("annee", String(query.annee));
  if (company !== null) {
    const single = categories.length === 1 ? categories[0] : undefined;
    if (single) params.set("categorie", single);
    else if (company !== "Sans catégorie") params.set("q", company);
  }
  return `/factures?${params.toString()}`;
}

/** Adresse de la page des créances avec ses filtres, éventuellement modifiés par `patch` (valeur `undefined` = retirer). */
export function receivablesHref(query: ReceivablesQuery, patch: Partial<ReceivablesQuery> = {}, anchor = ""): string {
  const merged: ReceivablesQuery = { ...query, ...patch };
  const params = new URLSearchParams();
  if (merged.annee) params.set("annee", String(merged.annee));
  if (merged.activite) params.set("activite", merged.activite);
  if (merged.detail) params.set("detail", merged.detail);
  if (merged.anc) params.set("anc", String(merged.anc));
  const text = params.toString();
  return `/creances${text ? `?${text}` : ""}${anchor ? `#${anchor}` : ""}`;
}
