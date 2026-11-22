/**
 * Logos de compagnies réellement déposés dans `public/partenaires/` (un fichier `<slug>.png` chacun).
 * Liste volontairement vide : aucun logo de compagnie n'est fourni dans le dépôt.
 * Pour en activer un, déposer le fichier puis ajouter son slug ici (voir `public/partenaires/LISEZMOI.md`).
 * Exemple : `["caar", "gam"]`.
 */
export const AVAILABLE_LOGOS: readonly string[] = [];

/** Chemin public du logo d'une compagnie, ou `null` s'il n'est pas déposé. */
export function logoPathOf(slug: string): string | null {
  return AVAILABLE_LOGOS.includes(slug) ? `/partenaires/${slug}.png` : null;
}
