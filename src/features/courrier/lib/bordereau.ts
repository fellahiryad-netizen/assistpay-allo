import { cleanText } from "@/features/courrier/lib/clean";
import { DEFAULT_OBSERVATION, type BordereauLine, type BranchAddress, type EnvoiLine } from "@/features/courrier/types";
import { upperPlain } from "@/utils/text";

/** Villes connues, avec leur écriture soignée (clé : majuscules sans accent). */
const CITIES: Readonly<Record<string, string>> = {
  ALGER: "ALGER",
  ORAN: "ORAN",
  ANNABA: "ANNABA",
  CONSTANTINE: "CONSTANTINE",
  GHARDAIA: "GHARDAÏA",
  SETIF: "SÉTIF",
  TLEMCEN: "TLEMCEN",
};

/** Mots de fin d'adresse qui ne sont pas une ville (le pays). */
const NOT_A_CITY = new Set(["ALGERIE"]);

/**
 * Ville déduite d'une adresse : dernier mot significatif (le pays et les nombres sont ignorés, « EDEN-ORAN » donne « ORAN »).
 * Les villes connues sont écrites avec leurs accents (« GHARDAÏA », « SÉTIF ») ; une autre ville est reprise en majuscules. Chaîne vide si rien d'exploitable.
 */
export function defaultDestination(adresse: string): string {
  const tokens = cleanText(adresse)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token !== "");
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    const token = tokens[index] ?? "";
    const key = upperPlain(token);
    if (/^\d+$/.test(token) || NOT_A_CITY.has(key)) continue;
    return CITIES[key] ?? token.toLocaleUpperCase("fr");
  }
  return "";
}

/** Destination à imprimer pour une fiche : celle de la fiche, sinon la ville déduite de l'adresse (fiches anciennes sans ce champ). */
export function branchDestination(branch: Pick<BranchAddress, "destination" | "adresse">): string {
  return cleanText(branch.destination ?? "") || defaultDestination(branch.adresse);
}

/** Lignes du bordereau pour une sélection de fiches : une ligne par fiche, quantité 1, observation par défaut. */
export function buildBordereauLines(branches: ReadonlyArray<Pick<BranchAddress, "nom" | "destination" | "adresse">>): BordereauLine[] {
  return branches.map((branch) => ({ designation: branch.nom, qnt: 1, destination: branchDestination(branch), observation: DEFAULT_OBSERVATION }));
}

/** Lignes de l'éditeur de bordereau : comme `buildBordereauLines`, avec l'identifiant et la compagnie de la fiche (gardés dans l'historique). */
export function buildEditorLines(branches: ReadonlyArray<Pick<BranchAddress, "id" | "compagnie" | "nom" | "destination" | "adresse">>): EnvoiLine[] {
  return branches.map((branch) => ({ brancheId: branch.id, compagnie: branch.compagnie, designation: branch.nom, qnt: 1, destination: branchDestination(branch), observation: DEFAULT_OBSERVATION }));
}

/** Total de plis : somme des quantités. */
export function totalPlis(lines: ReadonlyArray<Pick<BordereauLine, "qnt">>): number {
  return lines.reduce((sum, line) => sum + line.qnt, 0);
}

/** « ALGER LE : JJ/MM/AAAA » à partir d'une date `AAAA-MM-JJ`. */
export function bordereauDateLabel(iso: string): string {
  const [year = "", month = "", day = ""] = iso.split("-");
  return `ALGER LE : ${day}/${month}/${year}`;
}
