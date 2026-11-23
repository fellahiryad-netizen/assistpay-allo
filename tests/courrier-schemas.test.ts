import { describe, expect, it } from "vitest";
import { fieldErrors } from "@/features/courrier/lib/form-errors";
import { branchSchema, deleteFicheSchema, emsContactSchema, emsSocieteSchema, envelopeQuerySchema } from "@/features/courrier/schemas";

const valid = { compagnie: "CAAR", nom: "SUCCURSALE CAAR ORAN 400", contact: "", telephones: "041 70 68 01", adresse: "CITE ADMINISTRATIVE ILOT 26 ZHUN-USTO ORAN", remarque: "" };

describe("fiche de succursale", () => {
  it("accepte une fiche complète et nettoie les espaces", () => {
    const parsed = branchSchema.parse({ ...valid, nom: `  SUCCURSALE${String.fromCharCode(160)}CAAR   ORAN 400 `, telephones: "TEL : 041 70 68 01" });
    expect(parsed.nom).toBe("SUCCURSALE CAAR ORAN 400");
    expect(parsed.telephones).toBe("041 70 68 01");
  });

  it("le contact, le téléphone et la remarque sont facultatifs", () => {
    expect(branchSchema.safeParse({ ...valid, telephones: "", contact: "", remarque: "" }).success).toBe(true);
  });

  it("refuse la compagnie inconnue, le nom et l'adresse vides ou faits d'espaces, avec des messages en français", () => {
    const result = branchSchema.safeParse({ ...valid, compagnie: "GAM", nom: "   ", adresse: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const errors = fieldErrors(result.error);
      expect(errors.compagnie).toBe("Choisissez la compagnie (CAAR ou CAAT).");
      expect(errors.nom).toBe("Indiquez le nom de la succursale.");
      expect(errors.adresse).toBe("Indiquez l'adresse.");
    }
  });

  it("refuse un téléphone sans chiffre et les textes trop longs", () => {
    const phone = branchSchema.safeParse({ ...valid, telephones: "bureau" });
    expect(phone.success).toBe(false);
    const long = branchSchema.safeParse({ ...valid, adresse: "A".repeat(201) });
    expect(long.success).toBe(false);
    if (!long.success) expect(fieldErrors(long.error).adresse).toBe("Adresse trop longue (200 caractères au plus).");
    expect(branchSchema.safeParse({ ...valid, nom: "N".repeat(121) }).success).toBe(false);
    expect(branchSchema.safeParse({ ...valid, remarque: "r".repeat(301) }).success).toBe(false);
  });

  it("refuse une valeur qui n'est pas du texte", () => {
    expect(branchSchema.safeParse({ ...valid, nom: 12 }).success).toBe(false);
  });
});

describe("contact du prestataire de courrier", () => {
  const ems = { nom: "Hichem", role: "RAMASSEUR", telephone: "0697 38 88 81", email: "", remarque: "" };

  it("accepte un contact sans e-mail ; l'e-mail est mis en minuscules", () => {
    expect(emsContactSchema.safeParse(ems).success).toBe(true);
    expect(emsContactSchema.parse({ ...ems, email: " Illoul.M@EMS.dz " }).email).toBe("illoul.m@ems.dz");
  });

  it("refuse un e-mail invalide, un rôle inconnu, un téléphone vide", () => {
    expect(emsContactSchema.safeParse({ ...ems, email: "illoul@" }).success).toBe(false);
    expect(emsContactSchema.safeParse({ ...ems, role: "CHEF" }).success).toBe(false);
    const empty = emsContactSchema.safeParse({ ...ems, telephone: "" });
    expect(empty.success).toBe(false);
    if (!empty.success) expect(fieldErrors(empty.error).telephone).toBe("Indiquez le téléphone.");
  });
});

describe("société, suppression et paramètres d'impression", () => {
  it("société : nom obligatoire", () => {
    expect(emsSocieteSchema.safeParse({ nom: " EMS " }).success).toBe(true);
    expect(emsSocieteSchema.safeParse({ nom: "  " }).success).toBe(false);
  });

  it("suppression : identifiant obligatoire", () => {
    expect(deleteFicheSchema.safeParse({ id: "caar-oran-400" }).success).toBe(true);
    expect(deleteFicheSchema.safeParse({ id: "" }).success).toBe(false);
  });

  it("impression : liste d'identifiants dédoublonnée, jamais vide, 200 au plus", () => {
    expect(envelopeQuerySchema.parse({ ids: "a, b,a,,c" }).ids).toEqual(["a", "b", "c"]);
    expect(envelopeQuerySchema.safeParse({ ids: "" }).success).toBe(false);
    expect(envelopeQuerySchema.safeParse({ ids: " , " }).success).toBe(false);
    const many = Array.from({ length: 201 }, (_, index) => `id${index}`).join(",");
    expect(envelopeQuerySchema.safeParse({ ids: many }).success).toBe(false);
    expect(envelopeQuerySchema.safeParse({ ids: "x".repeat(65) }).success).toBe(false);
  });
});
