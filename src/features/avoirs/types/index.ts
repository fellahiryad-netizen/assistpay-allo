/** Facture établie sur laquelle on peut passer un avoir. */
export interface AvoirableInvoiceDTO {
  id: string;
  num: string;
  num2: string;
  client: string;
  clientLabel: string;
  succ: string;
  date: string | null;
  objet: string;
  perTxt: string;
  ht: number;
  tva: number;
  ttc: number;
  /** Total déjà passé en avoir (avoirs actifs, valeur positive). */
  avoirs: number;
  /** Reste que l'on peut encore passer en avoir. */
  reste: number;
  /** État de la ligne au suivi : EN_ATTENTE (non encaissée), REGLE (encaissée) ou null. */
  statut: string | null;
}

/** Avoir émis. */
export interface AvoirDTO {
  id: string;
  num: string;
  client: string;
  clientLabel: string;
  date: string | null;
  origineNum: string;
  origineId: string;
  /** Montant TTC de la facture d'origine. */
  origineTtc: number;
  /** Montants de l'avoir, en valeur positive. */
  ht: number;
  tva: number;
  ttc: number;
  /** Façon dont le montant a été établi : total, partiel (TTC réparti) ou libre. */
  mode: string;
  motif: string;
  annule: boolean;
  suite: string;
}

/** Données d'impression d'un avoir (montants affichés en négatif). */
export interface AvoirPrintData {
  num: string;
  date: string | null;
  annule: boolean;
  cli: { nom: string; adresse: string; tel: string; rc: string; nif: string; nis: string; ai: string };
  origine: { num: string; date: string | null; succ: string; perTxt: string; ht: number; tva: number; ttc: number };
  motif: string;
  suite: string;
  ht: number;
  tva: number;
  ttc: number;
  avoirsPrecedents: number;
  netRestant: number;
  lettres: string;
  emAi: string;
  /** Vrai si la facture d'origine est déjà réglée (le net n'est alors pas « dû »). */
  factureReglee: boolean;
}

/** Suivi des avoirs rattachés à une facture établie (facture d'origine). */
export interface AvoirTrackingDTO {
  origineId: string;
  origineNum: string;
  origineTtc: number;
  /** Avoirs actifs et annulés, du plus récent au plus ancien. */
  avoirs: Array<{ id: string; num: string; date: string | null; ttc: number; motif: string; annule: boolean }>;
  /** Total des avoirs actifs (valeur positive). */
  totalAvoirs: number;
  /** Facture d'origine moins avoirs actifs. */
  netRestant: number;
}

/** Avoirs actifs d'une facture, pour la pastille de la liste des factures. */
export interface AvoirBadgeDTO {
  origineId: string;
  avoirs: Array<{ id: string; num: string; ttc: number }>;
  /** Total des avoirs actifs (valeur positive). */
  total: number;
  /** Facture d'origine moins avoirs actifs. */
  net: number;
}
