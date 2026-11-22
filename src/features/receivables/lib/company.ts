import { upperPlain } from "@/utils/text";

/** Activité d'une créance : assistance routière, bris de glace (BDG) ou autre (TPA, AUTO QUAL…). */
export type ReceivableActivity = "ASSISTANCE" | "BDG" | "AUTRE";

/** Libellés français des activités. */
export const ACTIVITY_LABELS: Readonly<Record<ReceivableActivity, string>> = {
  ASSISTANCE: "Assistance",
  BDG: "BDG",
  AUTRE: "Autre",
};

/** Libellé de la compagnie quand la catégorie de la facture est vide. */
export const NO_CATEGORY = "Sans catégorie";

/** Compagnies d'assistance : leurs factures sans mention BDG relèvent de l'activité Assistance. */
const ASSISTANCE_COMPANIES: ReadonlySet<string> = new Set(["CAAR", "CAAT", "GAM", "TRUST", "MLA"]);

/** Classement d'une catégorie brute de facture. */
export interface CategorieClass {
  /** Compagnie, en majuscules (ex. « CAAT »). */
  company: string;
  activity: ReceivableActivity;
}

/**
 * Classe une catégorie brute : compagnie + activité.
 * Casse, accents et espaces multiples sont ignorés ; un mot « BDG » (avant ou après la compagnie) donne l'activité BDG
 * (« BDG CAAT » → CAAT, « GAM BDG » → GAM, « Trust BDG » → TRUST). Une catégorie vide donne « Sans catégorie ».
 * CAAR, CAAT, GAM, TRUST et MLA sont de l'assistance ; TPA, AUTO QUAL et toute autre valeur sont classés « Autre ».
 */
export function classifyCategorie(categorie: string | null | undefined): CategorieClass {
  const words = upperPlain(categorie ?? "")
    .split(/\s+/)
    .filter((word) => word.length > 0);
  if (words.length === 0) return { company: NO_CATEGORY, activity: "AUTRE" };
  const isBdg = words.includes("BDG");
  const rest = words.filter((word) => word !== "BDG");
  const company = rest.length > 0 ? rest.join(" ") : "BDG";
  if (isBdg) return { company, activity: "BDG" };
  return { company, activity: ASSISTANCE_COMPANIES.has(company) ? "ASSISTANCE" : "AUTRE" };
}

/** Compagnie d'une catégorie brute de facture (voir `classifyCategorie`). */
export function companyOf(categorie: string | null | undefined): string {
  return classifyCategorie(categorie).company;
}

/** Activité d'une catégorie brute de facture (voir `classifyCategorie`). */
export function activityOfCategorie(categorie: string | null | undefined): ReceivableActivity {
  return classifyCategorie(categorie).activity;
}

/** Identifiant de fichier d'une compagnie : minuscules, tirets (« AUTO QUAL » → « auto-qual »). */
export function companySlug(company: string): string {
  return upperPlain(company)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
