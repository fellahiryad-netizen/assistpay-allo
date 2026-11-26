import type { DpPrintableDTO } from "@/features/payment-requests/types";

/** Nombre maximal de demandes dans une impression multiple. */
export const PRINT_MAX = 100;

/** Demandes dont le bénéficiaire, le numéro, le produit ou le montant contient le texte cherché (sans accents ni casse). */
export function filterPrintable(items: readonly DpPrintableDTO[], search: string): DpPrintableDTO[] {
  const needle = search.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (!needle) return [...items];
  return items.filter((item) =>
    [item.ref, item.beneficiaire, item.produit, String(item.montant)].join(" ").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").includes(needle),
  );
}

/** Total des montants des demandes cochées, à deux décimales. */
export function selectedTotal(items: readonly DpPrintableDTO[], selected: ReadonlySet<string>): number {
  return Math.round(items.filter((item) => selected.has(item.id)).reduce((sum, item) => sum + item.montant, 0) * 100) / 100;
}

/** Ajoute (ou retire) les demandes visibles à la sélection, sans dépasser `PRINT_MAX`. Renvoie la nouvelle sélection et si la limite a coupé l'ajout. */
export function toggleVisible(selected: ReadonlySet<string>, visible: readonly DpPrintableDTO[], checked: boolean): { next: Set<string>; truncated: boolean } {
  const next = new Set(selected);
  let truncated = false;
  for (const item of visible) {
    if (!checked) next.delete(item.id);
    else if (next.size < PRINT_MAX) next.add(item.id);
    else truncated = true;
  }
  return { next, truncated };
}

/** Lien d'impression des demandes cochées, dans l'ordre de la liste affichée. */
export function printHref(items: readonly DpPrintableDTO[], selected: ReadonlySet<string>): string {
  return `/imprimer/demandes?ids=${items.filter((item) => selected.has(item.id)).map((item) => item.id).join(",")}`;
}
