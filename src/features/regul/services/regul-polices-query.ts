import { REGUL_SUCCURSALES } from "@/features/regul/services/regul-engine";
import type { PolicesQuery } from "@/features/regul/services/regul-polices";

const one = (v: string | string[] | undefined): string => (Array.isArray(v) ? (v[0] ?? "") : (v ?? "")).trim();

/** Lit et valide les paramètres d'URL ; toute valeur inconnue est ignorée. */
export function parsePolicesQuery(raw: Record<string, string | string[] | undefined>): PolicesQuery {
  const succ = one(raw.succ);
  const statut = one(raw.statut);
  const agence = Number.parseInt(one(raw.agence), 10);
  const mois = Number.parseInt(one(raw.mois), 10);
  return {
    succ: (REGUL_SUCCURSALES as readonly string[]).includes(succ) ? succ : "",
    agence: Number.isFinite(agence) && agence > 0 ? agence : null,
    statut: statut === "REPORTEE" || statut === "REPORTEE_PROBABLE" || statut === "ANNULEE" || statut === "INTROUVABLE" ? statut : "",
    mois: Number.isFinite(mois) && mois >= 1 && mois <= 12 ? mois : null,
  };
}
