/**
 * Logos de compagnies réellement déposés dans `public/partenaires/` (un fichier `<slug>.png` chacun).
 * TPA et AUTO QUAL n'ont pas de logo : ils s'affichent avec un monogramme.
 * Pour en activer un autre, déposer le fichier puis ajouter son slug ici (voir `public/partenaires/LISEZMOI.md`).
 */
export const AVAILABLE_LOGOS: readonly string[] = ["caar", "caat", "gam", "trust", "mla"];

/** Chemin public du logo d'une compagnie, ou `null` s'il n'est pas déposé. */
export function logoPathOf(slug: string): string | null {
  return AVAILABLE_LOGOS.includes(slug) ? `/partenaires/${slug}.png` : null;
}

/** Chemins publics des logos disponibles, par nom de compagnie (pour la légende des anneaux). */
export function logoMapOf(companies: readonly string[], slugOf: (company: string) => string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const company of companies) {
    const path = logoPathOf(slugOf(company));
    if (path) map[company] = path;
  }
  return map;
}
