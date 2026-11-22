import { describe, expect, it } from "vitest";
import { PROFILE_DEFAULTS, resolveAccess } from "@/features/access/services/access-rules";
import { MODULE_KEYS, PROFILE_KEYS, type AuthUser, type ProfileKey } from "@/features/access/types";
import { canAccessTreasury, requireTreasury } from "@/features/treasury/services/treasury-access";

/** Utilisateur de test ; `overrideAll` donne l'accès en modification à tous les onglets (exception individuelle maximale). */
function user(profile: ProfileKey, overrideAll = false): AuthUser {
  const access = resolveAccess(profile, overrideAll ? MODULE_KEYS.map((module) => ({ module, level: "EDIT" as const })) : []);
  return { id: "u1", email: "x@alloassistance.dz", name: "Test", profile, isAdmin: profile === "ADMINISTRATEUR" || profile === "DIRECTION", access };
}

describe("accès à la trésorerie", () => {
  it("Administrateur, Direction et Comptable : lecture et simulation", () => {
    for (const profile of ["ADMINISTRATEUR", "DIRECTION", "COMPTABLE"] as const) {
      expect(requireTreasury(user(profile), "view").success).toBe(true);
      expect(requireTreasury(user(profile), "simulate").success).toBe(true);
    }
  });
  it("réglages (réserve, solde manuel, encaissements) : Administrateur et Direction seulement", () => {
    expect(requireTreasury(user("ADMINISTRATEUR"), "settings").success).toBe(true);
    expect(requireTreasury(user("DIRECTION"), "settings").success).toBe(true);
    const refused = requireTreasury(user("COMPTABLE"), "settings");
    expect(refused.success).toBe(false);
    if (!refused.success) expect(refused.code).toBe("FORBIDDEN");
  });
  it("équipe facturation, chargé de facturation, RH et partenaire : refusés, même avec une exception d'accès individuelle", () => {
    for (const profile of ["EQUIPE_FACTURATION", "CHARGE_FACTURATION", "RH", "PARTENAIRE"] as const) {
      for (const level of ["view", "simulate", "settings"] as const) {
        expect(requireTreasury(user(profile), level).success).toBe(false);
        expect(requireTreasury(user(profile, true), level).success).toBe(false);
        expect(canAccessTreasury(user(profile, true), level)).toBe(false);
      }
    }
  });
  it("aucun profil n'a besoin d'une valeur ajoutée à l'enum des onglets", () => {
    expect(MODULE_KEYS).not.toContain("TRESO" as never);
    expect(PROFILE_KEYS.filter((profile) => canAccessTreasury({ profile }))).toEqual(["ADMINISTRATEUR", "DIRECTION", "COMPTABLE"]);
    expect(Object.keys(PROFILE_DEFAULTS)).toHaveLength(PROFILE_KEYS.length);
  });
});
