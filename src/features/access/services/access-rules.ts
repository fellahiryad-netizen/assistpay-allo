import type { AccessLevelKey, AccessMap, AuthUser, ModuleInfo, ModuleKey, ProfileKey } from "@/features/access/types";
import { MODULE_KEYS } from "@/features/access/types";
import { fail, ok, type ActionResult } from "@/types";

/** Liste ordonnée des onglets, regroupés comme dans le menu. */
export const MODULES: readonly ModuleInfo[] = [
  { key: "DASH", label: "Tableau de bord", group: "Pilotage" },
  { key: "PILOT", label: "Pilotage et clôture", group: "Pilotage", hint: "montre aussi la trésorerie et le relevé" },
  { key: "QC", label: "Contrôle qualité", group: "Pilotage" },
  { key: "FCLI", label: "Factures clients (crédit)", group: "Factures" },
  { key: "FFOUR", label: "Factures fournisseurs (débit)", group: "Factures" },
  { key: "PART", label: "Partenaires", group: "Ventes" },
  { key: "FACT", label: "Établir une facture", group: "Ventes" },
  { key: "CAAR", label: "CAAR production", group: "Ventes" },
  { key: "BDG", label: "BDG débours et frais", group: "Ventes" },
  { key: "DP", label: "Demandes de paiement", group: "Achats et banque" },
  { key: "VIR", label: "Virements et RIB", group: "Achats et banque" },
  { key: "RELEVE", label: "Relevé bancaire", group: "Achats et banque" },
  { key: "RH", label: "RH (salaires)", group: "Administration" },
];

/** Libellés français des profils. */
export const PROFILE_LABELS: Readonly<Record<ProfileKey, string>> = {
  ADMINISTRATEUR: "Administrateur",
  DIRECTION: "Direction",
  EQUIPE_FACTURATION: "Équipe facturation",
  CHARGE_FACTURATION: "Chargé de facturation",
  COMPTABLE: "Comptable",
  RH: "RH",
  PARTENAIRE: "Partenaire",
};

/** Libellés français des niveaux. */
export const LEVEL_LABELS: Readonly<Record<AccessLevelKey, string>> = {
  NONE: "Aucun accès",
  VIEW: "Consultation",
  EDIT: "Modification",
};

function all(level: AccessLevelKey): AccessMap {
  return Object.fromEntries(MODULE_KEYS.map((key) => [key, level])) as AccessMap;
}

/** Accès par défaut de chaque profil (repris de la version actuelle d'AssistPay). */
export const PROFILE_DEFAULTS: Readonly<Record<ProfileKey, AccessMap>> = {
  ADMINISTRATEUR: all("EDIT"),
  DIRECTION: all("EDIT"),
  COMPTABLE: all("EDIT"),
  EQUIPE_FACTURATION: { ...all("EDIT"), RH: "NONE" },
  CHARGE_FACTURATION: { ...all("EDIT"), DASH: "VIEW", PILOT: "NONE", RELEVE: "NONE", RH: "NONE" },
  RH: { ...all("NONE"), RH: "EDIT" },
  PARTENAIRE: all("NONE"),
};

/** Les profils Administrateur et Direction ont tous les droits, sans exception possible. */
export function isAdminProfile(profile: ProfileKey): boolean {
  return profile === "ADMINISTRATEUR" || profile === "DIRECTION";
}

/**
 * Calcule l'accès effectif : profil par défaut, puis exceptions choisies dans le tableau des accès.
 * Les exceptions sont ignorées pour les profils administrateurs.
 */
export function resolveAccess(
  profile: ProfileKey,
  overrides: ReadonlyArray<{ module: ModuleKey; level: AccessLevelKey }>,
): AccessMap {
  if (isAdminProfile(profile)) return all("EDIT");
  const map: AccessMap = { ...PROFILE_DEFAULTS[profile] };
  for (const item of overrides) map[item.module] = item.level;
  return map;
}

/** Vrai si l'utilisateur a au moins le niveau demandé sur l'onglet. */
export function can(user: AuthUser, module: ModuleKey, level: Exclude<AccessLevelKey, "NONE"> = "VIEW"): boolean {
  if (user.isAdmin) return true;
  const granted = user.access[module];
  return level === "EDIT" ? granted === "EDIT" : granted !== "NONE";
}

/** Contrôle d'accès à utiliser en tête de chaque service ; renvoie une erreur FORBIDDEN si refusé. */
export function requireAccess(
  user: AuthUser,
  module: ModuleKey,
  level: Exclude<AccessLevelKey, "NONE"> = "VIEW",
): ActionResult<true> {
  if (can(user, module, level)) return ok(true);
  const info = MODULES.find((item) => item.key === module);
  const what = level === "EDIT" ? "modifier" : "consulter";
  return fail(`Vous n'avez pas le droit de ${what} « ${info?.label ?? module} ».`, "FORBIDDEN");
}

/** Contrôle réservé aux administrateurs (utilisateurs, tableau des accès, journal d'administration). */
export function requireAdmin(user: AuthUser): ActionResult<true> {
  return user.isAdmin ? ok(true) : fail("Action réservée aux administrateurs.", "FORBIDDEN");
}
