import { companySlug } from "@/features/receivables/lib/company";

/**
 * Couleurs distinctes (testées pour les daltoniens : bleu, orange, vert, violet, magenta, or, turquoise, ardoise),
 * assez foncées pour porter du texte blanc.
 */
export const COMPANY_PALETTE: readonly string[] = ["#0072B2", "#C25A00", "#0E7C5A", "#6D3FB5", "#B83280", "#8A6D00", "#007C91", "#4B5563"];

const KNOWN: Readonly<Record<string, number>> = { caar: 0, caat: 1, gam: 2, trust: 3, mla: 4, tpa: 5, "auto-qual": 6 };

/** Couleur stable d'une compagnie : fixe pour les compagnies connues, sinon calculée sur le nom. */
export function companyColor(company: string): string {
  const slug = companySlug(company);
  const known = KNOWN[slug];
  if (known !== undefined) return COMPANY_PALETTE[known] ?? "#4B5563";
  let hash = 0;
  for (const char of slug) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return COMPANY_PALETTE[hash % COMPANY_PALETTE.length] ?? "#4B5563";
}

/** Initiales d'un monogramme : deux initiales pour un nom à plusieurs mots, sinon le nom (4 lettres max, 3 au-delà). */
export function monogramOf(company: string): string {
  const words = company.trim().split(/\s+/).filter((word) => word.length > 0);
  if (words.length === 0) return "?";
  if (words.length > 1) return words.slice(0, 2).map((word) => word.charAt(0)).join("").toUpperCase();
  const word = words[0] ?? "?";
  return (word.length <= 4 ? word : word.slice(0, 3)).toUpperCase();
}
