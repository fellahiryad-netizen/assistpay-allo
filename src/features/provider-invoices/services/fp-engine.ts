/* Suivi des factures prestataires : demande (Soheib) → facture établie et envoyée (Kenza) → original reçu → à payer → payée.
   Fonctions pures, utilisées côté serveur et dans le navigateur. */

/** Produit : assistance routière ou BDG. */
export type FpProduit = "A" | "B";

/** Étape de la facture. */
export type FpStatut = "A_ETABLIR" | "ENVOYEE" | "A_PAYER" | "PAYEE" | "ANNULEE";

/** Libellés des étapes. */
export const FP_STATUTS: Readonly<Record<FpStatut, string>> = {
  A_ETABLIR: "À établir",
  ENVOYEE: "Envoyée, original attendu",
  A_PAYER: "Original reçu, à payer",
  PAYEE: "Payée",
  ANNULEE: "Annulée",
};

/** Libellés des produits. */
export const FP_PRODUITS: Readonly<Record<FpProduit, string>> = { A: "Assistance routière", B: "BDG" };

/** Délai (jours) après l'envoi au-delà duquel l'original attendu est signalé en retard. */
export const FP_RETARD_JOURS = 10;

/** Étape suivante autorisée pour chaque étape. */
export const FP_SUIVANT: Readonly<Partial<Record<FpStatut, FpStatut>>> = { A_ETABLIR: "ENVOYEE", ENVOYEE: "A_PAYER", A_PAYER: "PAYEE" };

/** Une entrée de l'historique d'une facture. */
export interface FpEvent {
  st: FpStatut | "CREE" | "MODIF";
  le: string;
  par: string;
  note?: string;
}

/** Facture prestataire suivie. */
export interface FpRequest {
  id: string;
  p: FpProduit;
  nom: string;
  prenom: string;
  /** Numéro du portail, ex. FACT00723/2026. */
  num: string;
  /** Date de la demande (AAAA-MM-JJ). */
  date: string;
  mt: number | null;
  obs: string;
  st: FpStatut;
  /** Date du dernier dossier (information de l'ancien fichier). */
  dd?: string | null;
  /** Date d'envoi au prestataire. */
  envoyeLe?: string | null;
  recuLe?: string | null;
  hist: FpEvent[];
}

/** Prestataire à qui l'on envoie la facture pour cachet et signature. */
export interface FpPrestataire {
  id: string;
  nom: string;
  email: string;
  actif: boolean;
}

const PREFIX: Readonly<Record<FpProduit, string>> = { A: "FACT", B: "BDG" };

/** Découpe « FACT00723/2026 » en préfixe, numéro et année ; null si le format est incorrect. */
export function parseNum(value: string): { p: FpProduit; n: number; year: number } | null {
  const match = /^(FACT|BDG)(\d{3,6})\/(\d{4})$/i.exec(value.trim());
  if (!match) return null;
  return { p: (match[1] ?? "").toUpperCase() === "BDG" ? "B" : "A", n: Number(match[2]), year: Number(match[3]) };
}

/** Écrit un numéro au format du portail (5 chiffres). */
export function formatNum(p: FpProduit, n: number, year: number): string {
  return `${PREFIX[p]}${String(n).padStart(5, "0")}/${year}`;
}

/** Dernier numéro utilisé pour un produit et une année (hors annulées), avec le numéro suivant proposé. */
export function lastNumber(reqs: ReadonlyArray<FpRequest>, p: FpProduit, year: number): { last: FpRequest | null; next: string } {
  let last: FpRequest | null = null;
  let max = 0;
  for (const req of reqs) {
    if (req.p !== p || req.st === "ANNULEE") continue;
    const parsed = parseNum(req.num);
    if (!parsed || parsed.year !== year) continue;
    if (parsed.n > max) {
      max = parsed.n;
      last = req;
    }
  }
  return { last, next: formatNum(p, max + 1, year) };
}

/** Numéros manquants parmi les 40 derniers (un trou = numéro pris au portail mais absent du suivi). */
export function gaps(reqs: ReadonlyArray<FpRequest>, p: FpProduit, year: number): string[] {
  const used = new Set<number>();
  for (const req of reqs) {
    const parsed = parseNum(req.num);
    if (parsed && parsed.p === p && parsed.year === year) used.add(parsed.n);
  }
  if (!used.size) return [];
  const max = Math.max(...used);
  const out: string[] = [];
  for (let n = Math.max(1, max - 40); n < max; n++) if (!used.has(n)) out.push(formatNum(p, n, year));
  return out;
}

/** Jours écoulés depuis une date (AAAA-MM-JJ) jusqu'à aujourd'hui. */
export function ageDays(from: string | null | undefined, today: string): number {
  if (!from) return 0;
  return Math.max(0, Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000));
}

/** Facture envoyée dont l'original se fait trop attendre. */
export function enRetard(req: FpRequest, today: string): boolean {
  return req.st === "ENVOYEE" && ageDays(req.envoyeLe ?? req.date, today) > FP_RETARD_JOURS;
}

/** Nom complet affiché. */
export function fullName(req: Pick<FpRequest, "nom" | "prenom">): string {
  return `${req.nom} ${req.prenom}`.replace(/\s+/g, " ").trim();
}

/** Message de relance prêt à envoyer pour un original attendu. */
export function relanceText(req: FpRequest): { subject: string; body: string } {
  return {
    subject: `Facture ${req.num} : original à nous retourner`,
    body: [
      "Bonjour,",
      "",
      `Nous n'avons pas encore reçu l'original de la facture ${req.num}, établie le ${req.envoyeLe ?? req.date}. Pourriez-vous nous le faire parvenir, cacheté et signé, par courrier ?`,
      "",
      "Le paiement ne pourra être lancé qu'à réception de l'original.",
      "",
      "Cordialement,",
      "Allo Assistance",
    ].join("\n"),
  };
}
