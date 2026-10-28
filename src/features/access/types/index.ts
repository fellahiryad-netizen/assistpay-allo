/** Onglets soumis au tableau des accès (mêmes valeurs que l'enum Prisma `Module`). */
export const MODULE_KEYS = ["DASH", "PILOT", "QC", "FCLI", "FFOUR", "PART", "FACT", "CAAR", "BDG", "DP", "VIR", "RELEVE", "RH"] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

/** Niveaux d'accès (enum Prisma `AccessLevel`). */
export const ACCESS_LEVELS = ["NONE", "VIEW", "EDIT"] as const;
export type AccessLevelKey = (typeof ACCESS_LEVELS)[number];

/** Profils métier (enum Prisma `Profile`). */
export const PROFILE_KEYS = [
  "ADMINISTRATEUR",
  "DIRECTION",
  "EQUIPE_FACTURATION",
  "CHARGE_FACTURATION",
  "COMPTABLE",
  "RH",
  "PARTENAIRE",
] as const;
export type ProfileKey = (typeof PROFILE_KEYS)[number];

/** Description d'un onglet pour l'affichage du tableau des accès. */
export interface ModuleInfo {
  key: ModuleKey;
  label: string;
  group: string;
  hint?: string;
}

/** Accès effectif d'un utilisateur, onglet par onglet. */
export type AccessMap = Record<ModuleKey, AccessLevelKey>;

/** Utilisateur connecté, tel que vu par les services. */
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  profile: ProfileKey;
  isAdmin: boolean;
  access: AccessMap;
}
