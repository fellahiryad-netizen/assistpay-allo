/** Compte donneur d'ordre : EURL ALLO ASSISTANCE, AGB 032 00001 2737851208 90. */
export const DONOR = { banque: "032", agence: "00001", compte: "2737851208", cle: "90", nom: "EURL ALLO", prenom: "ASSISTANCE", adresse: "ALGER" } as const;

/** RIB complet du donneur d'ordre (20 chiffres). */
export const DONOR_RIB = `${DONOR.banque}${DONOR.agence}${DONOR.compte}${DONOR.cle}`;

/** Plafond bancaire par virement. */
export const TRANSFER_CEILING = 1_000_000;

/** Seuil mensuel par prestataire au-delà duquel un administrateur doit valider l'envoi. */
export const MONTHLY_DOUBLE_CHECK = 2_000_000;

/** Banques algériennes par code. */
export const BANKS: Readonly<Record<string, string>> = {
  "001": "BNA",
  "002": "BEA",
  "003": "BADR",
  "004": "CPA",
  "005": "BDL",
  "006": "Al Baraka",
  "007": "Algérie Poste (CCP)",
  "010": "CNMA",
  "011": "CNEP-Banque",
  "012": "Citibank",
  "014": "ABC Algeria",
  "020": "Natixis",
  "021": "Société Générale",
  "026": "Arab Bank",
  "027": "BNP Paribas",
  "029": "Trust Bank",
  "031": "Housing Bank",
  "032": "AGB (Gulf Bank)",
  "035": "Fransabank",
  "036": "Crédit Agricole CIB",
  "037": "HSBC",
  "038": "Al Salam Bank",
  "111": "Banque d'Algérie",
};

/** Produits des fichiers de virements : A = assistance routière, B = BDG. */
export const TRANSFER_PRODUCTS = {
  A: { label: "Assistance routière", file: "VRMNT_ASSIS", dpProduct: "Assistance routière" },
  B: { label: "BDG", file: "VRMNT_BDG", dpProduct: "BDG" },
} as const;
export type TransferProduct = keyof typeof TRANSFER_PRODUCTS;

function mod97(digits: string): number {
  let rest = 0;
  for (const char of digits) rest = (rest * 10 + (char.charCodeAt(0) - 48)) % 97;
  return rest;
}

/** Clé RIB algérienne calculée sur l'agence et le compte. */
export function ribKey(agence: string, compte: string): number {
  return 97 - mod97(`${agence}${compte}00`);
}

/** Parties d'un RIB de 20 chiffres, ou `null`. */
export function ribParts(rib: string): { banque: string; agence: string; compte: string; cle: string } | null {
  const digits = rib.replace(/\D/g, "");
  return digits.length === 20 ? { banque: digits.slice(0, 3), agence: digits.slice(3, 8), compte: digits.slice(8, 18), cle: digits.slice(18) } : null;
}

/** RIB valide : 20 chiffres et clé correcte. */
export function ribValid(rib: string): boolean {
  const parts = ribParts(rib);
  return parts !== null && Number(parts.cle) === ribKey(parts.agence, parts.compte);
}

/** Clé de compte du référentiel : banque + compte (sans agence ni clé). */
export function accountKey(rib: string): string {
  const parts = ribParts(rib);
  return parts ? `${parts.banque}${parts.compte}` : "";
}

/** RIB lisible : « 032 00001 2737851208 90 ». */
export function formatRib(rib: string): string {
  const parts = ribParts(rib);
  return parts ? `${parts.banque} ${parts.agence} ${parts.compte} ${parts.cle}` : rib;
}

/** Découpe un montant en virements égaux de 1 000 000 DA au plus (au centime, le reste sur le dernier). */
export function splitAmount(amount: number): number[] {
  const cents = Math.round(amount * 100);
  const count = Math.max(1, Math.ceil(cents / (TRANSFER_CEILING * 100)));
  const base = Math.floor(cents / count);
  return Array.from({ length: count }, (_, index) => (index === count - 1 ? cents - base * (count - 1) : base) / 100);
}

/** Nom et prénom séparés : premier mot = nom (règle de l'ancienne version). */
export function splitName(full: string): { nom: string; prenom: string } {
  const words = full.replace(/\(.*?\)/g, " ").replace(/\s+/g, " ").trim().split(" ");
  return { nom: words[0] ?? "", prenom: words.slice(1).join(" ") };
}
