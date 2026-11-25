import type { CourrierCompany } from "@/features/courrier/types";

/** Compagnie à repérer sur les impressions : CAAT ou CAAR (une fiche d'une autre compagnie, ou sans compagnie, n'a pas de repère). */
export type MarkedCompany = CourrierCompany;

/** Sigle décomposé pour l'impression : la première lettre, les deux « a » en petit, la dernière lettre en très grand (seule différence entre CAAT et CAAR). */
export interface SigleParts {
  first: string;
  small: string;
  last: string;
}

/** Chemin du logo de la compagnie (image du dossier public/partenaires). */
export const COMPANY_LOGOS: Readonly<Record<MarkedCompany, string>> = { CAAT: "/partenaires/caat.png", CAAR: "/partenaires/caar.png" };

/**
 * Nom complet imprimé sous le sigle. Ces intitulés sont ceux qui figurent sur les logos du dépôt (public/partenaires/caar.png et caat.png) ;
 * ne pas les modifier sans vérifier la dénomination officielle.
 */
export const COMPANY_NAMES: Readonly<Record<MarkedCompany, string>> = {
  CAAT: "COMPAGNIE ALGÉRIENNE DES ASSURANCES",
  CAAR: "COMPAGNIE ALGÉRIENNE D'ASSURANCE ET DE RÉASSURANCE",
};

/** Sigle décomposé d'une compagnie, par exemple `CAAT` donne « CAA » (majuscules, caractères normaux), « » et « T » (dernière lettre, en gras et soulignée). */
export function sigleParts(company: MarkedCompany): SigleParts {
  return { first: company.slice(0, -1), small: "", last: company.slice(-1) };
}

/** Sigle écrit comme sur le repère imprimé : « CAAT », « CAAR ». */
export function sigleText(company: MarkedCompany): string {
  const parts = sigleParts(company);
  return `${parts.first}${parts.small}${parts.last}`;
}

/** Compagnie à repérer pour une valeur lue dans une fiche ou une ligne : `null` si ce n'est ni CAAT ni CAAR. */
export function markedCompany(value: string | null | undefined): MarkedCompany | null {
  return value === "CAAT" || value === "CAAR" ? value : null;
}

/** Rang d'impression : CAAT d'abord, puis CAAR, puis le reste. */
const RANK: Readonly<Record<string, number>> = { CAAT: 0, CAAR: 1 };

/** Groupe de lignes d'une même compagnie. */
export interface CompanyGroup<T> {
  /** Compagnie du groupe, ou chaîne vide pour les lignes sans repère. */
  compagnie: MarkedCompany | "";
  items: T[];
}

/**
 * Regroupe des lignes par compagnie pour l'impression et l'aperçu. Avec une seule compagnie (ou aucune), l'ordre de la sélection est gardé ;
 * avec plusieurs, CAAT vient d'abord, puis CAAR, puis les lignes sans repère. L'ordre à l'intérieur d'un groupe ne change jamais.
 * La liste d'origine n'est pas modifiée : seules l'impression et l'aperçu changent d'ordre, pas les données enregistrées.
 */
export function groupByCompany<T extends { compagnie: string }>(items: readonly T[]): CompanyGroup<T>[] {
  const keys = [...new Set(items.map((item) => markedCompany(item.compagnie) ?? ""))];
  if (keys.length === 0) return [];
  if (keys.length === 1) return [{ compagnie: keys[0] as CompanyGroup<T>["compagnie"], items: [...items] }];
  const ordered = [...keys].sort((a, b) => (RANK[a] ?? 2) - (RANK[b] ?? 2));
  return ordered.map((key) => ({ compagnie: key as CompanyGroup<T>["compagnie"], items: items.filter((item) => (markedCompany(item.compagnie) ?? "") === key) }));
}

/** Libellé d'un sous-total : « CAAT : 3 plis » (singulier pour un pli). */
export function subtotalLabel(company: MarkedCompany, plis: number): string {
  return `${sigleText(company)} : ${plis} ${plis > 1 ? "plis" : "pli"}`;
}
