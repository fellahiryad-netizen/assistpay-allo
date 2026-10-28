import type { AccessLevelKey, AccessMap, ModuleKey, ProfileKey } from "@/features/access/types";

/** Ligne du tableau des accès. */
export interface UserAccessRow {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  profile: ProfileKey;
  active: boolean;
  hasPassword: boolean;
  lastLoginAt: string | null;
  /** Accès effectif (profil + exceptions). */
  access: AccessMap;
  /** Onglets où un niveau a été choisi à la main. */
  overrides: Partial<Record<ModuleKey, AccessLevelKey>>;
}
