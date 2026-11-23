import { describe, expect, it } from "vitest";
import { CAAR_FLAGS } from "@/features/caar/services/caar-engine";

describe("message de contrôle CAAR", () => {
  it("ne reprend plus la non-conformité au barème", () => {
    expect(CAAR_FLAGS.PRIME_KO.ask).toBeNull();
  });
  it("signale agence, immatriculation, formule absentes et police Tunisie à prime non nulle", () => {
    expect(CAAR_FLAGS.AG_MISSING.ask).toBeTruthy();
    expect(CAAR_FLAGS.IMM_MISSING.ask).toBeTruthy();
    expect(CAAR_FLAGS.PROD_UNK.ask).toBeTruthy();
    expect(CAAR_FLAGS.TUNISIE_NZ.ask).toMatch(/Tunisie/);
  });
});

import { analyseCaarWorkbook, DEFAULT_BAREME } from "@/features/caar/services/caar-engine";

describe("message généré sur un fichier réel simulé", () => {
  const header = ["Code agence", "N° police", "Nom assuré", "Immatriculation", "Date effet", "Date échéance", "Formule", "Prime nette"];
  const sheet = {
    name: "Feuil1",
    rows: [
      header,
      ["101", "P1", "A", "111-16-16", "2026-10-01", "2027-09-30", "Formule 1", 2400],
      ["", "P2", "B", "222-16-16", "2026-10-01", "2027-09-30", "Formule 1", 2400],
      ["101", "P3", "C", "NA", "2026-10-01", "2027-09-30", "Formule 1", 2400],
      ["101", "P4", "D", "444-16-16", "2026-10-01", "2027-09-30", "NA", 2400],
      ["101", "P5", "E", "555-16-16", "2026-10-01", "2027-09-30", "Formule Tunisie", 1500],
      ["101", "P6", "F", "666-16-16", "2026-10-01", "2027-09-30", "Formule Tunisie", 0],
      ["101", "P7", "G", "777-16-16", "2026-10-01", "2027-09-30", "Formule 1", 1777],
    ],
  };
  const result = analyseCaarWorkbook([sheet], "caar_oct_2026_cheraga.xlsx", DEFAULT_BAREME, 2026);
  it("signale agence, immatriculation, formule et Tunisie non nulle, jamais le barème", () => {
    const message = result?.message ?? "";
    expect(message).toMatch(/Code agence manquant/);
    expect(message).toMatch(/Immatriculation manquante/);
    expect(message).toMatch(/Formule d'assistance absente/);
    expect(message).toMatch(/Police Tunisie/);
    expect(message).not.toMatch(/barème/i);
  });
  it("garde la prime non conforme à l'écran sans toucher aux totaux", () => {
    expect(result?.stats.kinds.PRIME_KO).toBeGreaterThan(0);
    expect(result?.stats.kinds.TUNISIE_NZ).toBe(1);
  });
});
