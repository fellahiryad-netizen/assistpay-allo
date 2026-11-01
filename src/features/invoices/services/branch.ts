import { upperPlain } from "@/utils/text";

/** Succursales CAAR suivies (noms de référence, sans accent). */
export const CAAR_BRANCHES = ["Cheraga", "Bouzareah", "Constantine", "Annaba", "Oran"] as const;

/** Champs d'une facture utiles pour retrouver sa succursale. */
export interface BranchSource {
  categorie: string;
  succursale: string;
  tiers: string;
  libelle: string;
}

/**
 * Succursale d'une facture, en majuscules sans accent : champ « succursale », sinon déduite du libellé ;
 * pour le CAAR, les cinq succursales sont reconnues dans le tiers et le libellé (règle de l'ancienne version).
 */
export function branchOf(invoice: BranchSource): string {
  if (invoice.categorie === "CAAR") {
    const text = upperPlain(`${invoice.succursale} ${invoice.tiers} ${invoice.libelle}`);
    const found = CAAR_BRANCHES.find((name) => text.includes(upperPlain(name)) || (name === "Bouzareah" && /BOUZAR/.test(text)) || (name === "Cheraga" && /CHERAGA|CHERAGHA/.test(text)));
    if (found) return upperPlain(found);
  }
  let value = invoice.succursale;
  if (!value) {
    const match = invoice.libelle.match(/succursale[\s\-–_/:]*([A-Za-zÀ-ÿ]+(?:[\s-]?(?:I{1,3}|\d{1,3}))?)/i);
    value = match?.[1] ?? "";
  }
  return upperPlain(value.replace(/^succursale\s*/i, ""))
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b111\b/, "III")
    .replace(/\b11\b/, "II")
    .replace(/\b0?1\b/, "I");
}

const PRETTY: Readonly<Record<string, string>> = {
  CHERAGA: "Chéraga (Alger)",
  BOUZAREAH: "Bouzaréah (Alger)",
  "ALGER I": "Alger I",
  "ALGER II": "Alger II",
  "ALGER III": "Alger III",
  SETIF: "Sétif",
  GHARDAIA: "Ghardaïa",
  CONSTANTINE: "Constantine",
  ANNABA: "Annaba",
  ORAN: "Oran",
  TLEMCEN: "Tlemcen",
  SUD: "Sud",
};

/**
 * Nom lisible de la succursale (« Chéraga (Alger) », « Alger II », « Sétif »…), vide si elle est inconnue.
 * Complète `branchOf` pour les factures CAAT dont seule la colonne « tiers » porte la succursale (« ALGER 02 »).
 */
export function branchLabel(invoice: BranchSource): string {
  let key = branchOf(invoice);
  if (!key || key === "SUCCURSALE") {
    const alger = upperPlain(invoice.tiers).match(/ALGER\s?0?(\d)/);
    key = alger ? `ALGER ${["", "I", "II", "III"][Number(alger[1])] ?? alger[1]}` : "";
  }
  if (!key) return "";
  const pretty = PRETTY[key];
  if (pretty) return pretty;
  return key.toLowerCase().replace(/(^|[\s-])\p{L}/gu, (letter) => letter.toUpperCase());
}
