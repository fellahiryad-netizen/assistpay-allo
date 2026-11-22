import type { AuthUser, ProfileKey } from "@/features/access/types";
import { fail, ok, type ActionResult } from "@/types";

/** Niveaux d'accès à la trésorerie : lecture, simulation (lignes et scénarios), réglages (réserve, solde manuel, encaissements). */
export type TreasuryLevel = "view" | "simulate" | "settings";

const VIEW_PROFILES: readonly ProfileKey[] = ["ADMINISTRATEUR", "DIRECTION", "COMPTABLE"];
const SETTINGS_PROFILES: readonly ProfileKey[] = ["ADMINISTRATEUR", "DIRECTION"];

/**
 * Accès à l'onglet Trésorerie, décidé sur le seul profil : Administrateur, Direction et Comptable. Aucun autre profil n'y accède,
 * même avec une exception d'accès individuelle (le tableau des accès n'est pas consulté). Lecture et simulation : les trois profils ;
 * réglages : Administrateur et Direction.
 */
export function canAccessTreasury(user: Pick<AuthUser, "profile">, level: TreasuryLevel = "view"): boolean {
  return (level === "settings" ? SETTINGS_PROFILES : VIEW_PROFILES).includes(user.profile);
}

/** Contrôle à appeler en tête de chaque service, action et route d'export de la trésorerie (le menu masqué ne suffit pas). */
export function requireTreasury(actor: Pick<AuthUser, "profile">, level: TreasuryLevel = "view"): ActionResult<true> {
  if (canAccessTreasury(actor, level)) return ok(true);
  const what = level === "settings" ? "modifier les réglages de la trésorerie" : level === "simulate" ? "modifier la simulation de trésorerie" : "consulter la trésorerie";
  return fail(`Vous n'avez pas le droit de ${what}.`, "FORBIDDEN");
}
