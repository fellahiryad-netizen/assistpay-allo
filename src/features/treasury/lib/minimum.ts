import { formatDA } from "@/utils/format";
import { millions } from "@/features/treasury/lib/format";

/** Libellé de l'indicateur partout (écran, impression, Excel, PDF). */
export const MINIMUM_LABEL = "Minimum de trésorerie";

/** Ce qui est nécessaire pour décrire le minimum de trésorerie. */
export interface MinimumInfo {
  minimumMode: "montant" | "jours";
  cushion: number;
  cushionDays: number;
  reference: { perMonth: number; months: string[] } | null;
}

/** Définition courte du minimum de trésorerie, avec le montant exact. */
export function minimumExplanation(info: MinimumInfo): string {
  if (info.minimumMode === "montant") return `Montant fixé par la direction : ${formatDA(info.cushion)}. Le niveau passe en Orange si le solde descend sous ce montant.`;
  return info.reference
    ? `${info.cushionDays} jours de dépenses habituelles (${millions(info.reference.perMonth)} par mois sur ${info.reference.months.length} mois complets), soit ${formatDA(info.cushion)}.`
    : `${info.cushionDays} jours de dépenses habituelles : historique du relevé insuffisant pour le calculer.`;
}
