/** Types du registre de numérotation (lecture seule : aucune règle de numérotation n'est portée ici). */

/** Famille de numéros : chaque famille a sa propre suite par année, comme les générateurs actuels. */
export type SeriesKind = "FACT" | "AB" | "TRUST_BDG" | "CAAT_BDG" | "AVOIR";

/** Libellés français des séries. */
export const SERIES_LABELS: Readonly<Record<SeriesKind, string>> = {
  FACT: "Factures partenaires (suite commune à tous les partenaires)",
  AB: "BDG GAM : factures globales « AB »",
  TRUST_BDG: "BDG TRUST : débours et frais",
  CAAT_BDG: "BDG CAAT : débours et frais",
  AVOIR: "Factures d'avoir",
};

/** Provenance d'un numéro lu en base. */
export type NumberOrigin = "suivi" | "etablie" | "avoir";

/** Un numéro lu en base, rattaché au document qui le porte. */
export interface NumberSource {
  /** Texte du numéro tel qu'enregistré (peut contenir deux numéros : « CAAT26-155&156BDG »). */
  raw: string;
  /** Identifiant du document : une facture du suivi et sa facture établie partagent la même clé. */
  docKey: string;
  origin: NumberOrigin;
  /** Libellé lisible (tiers, partenaire). */
  label: string;
}

/** Origine de la trace : journal, demande validée, ou ancien numéro remplacé lors d'une rectification. */
export type DeletionOrigin = "journal" | "demande" | "rectification";

/** Trace d'une suppression (journal ou demande validée) contenant un ou plusieurs numéros. */
export interface DeletionTrace {
  text: string;
  at?: string;
  by?: string;
  motif?: string;
  origin: DeletionOrigin;
}

/** Un numéro reconnu dans un texte. */
export interface ParsedNumber {
  kind: SeriesKind;
  year: number;
  seq: number;
  /** Préfixe lu dans le numéro (partenaire), vide si la série n'en a pas. */
  prefix: string;
  /** Texte exact reconnu. */
  text: string;
}

/** Document qui porte un numéro (pour l'affichage des doublons). */
export interface DocRef {
  docKey: string;
  label: string;
  origin: NumberOrigin;
  raw: string;
}

/** Suppression retenue pour un numéro. */
export interface DeletionInfo {
  at: string | null;
  by: string | null;
  motif: string | null;
  origin: DeletionOrigin;
}

/** Plage de numéros manquants. */
export interface GapRange {
  from: number;
  to: number;
  count: number;
  fromDisplay: string;
  toDisplay: string;
  /** Vrai si une suppression connue explique ces numéros. */
  explained: boolean;
  /** Vrai si la plage précède le premier numéro enregistré (reprise de l'historique probable). */
  beforeFirst: boolean;
}

/** Numéro porté par plusieurs documents distincts. */
export interface DuplicateInfo {
  seq: number;
  display: string;
  docs: DocRef[];
}

/** Situation d'un numéro issu d'une facture supprimée. */
export type FreedStatus = "libre_reprise" | "libre_trou" | "reutilise";

/** Numéro d'une facture supprimée. */
export interface FreedNumber {
  seq: number;
  display: string;
  status: FreedStatus;
  deletion: DeletionInfo;
}

/** Statistique d'un partenaire (préfixe) dans la suite commune. */
export interface PartnerStat {
  prefix: string;
  count: number;
  lastSeq: number;
  lastDisplay: string;
}

/** Résumé d'une série (famille + année). */
export interface SeriesSummary {
  key: string;
  kind: SeriesKind;
  year: number;
  label: string;
  /** Nombre de numéros distincts en base. */
  count: number;
  /** Nombre de documents portant au moins un numéro de la série. */
  documents: number;
  first: number;
  last: number;
  lastDisplay: string;
  /** Prochain numéro que proposerait la règle actuelle (dernier + 1). */
  nextSeq: number;
  nextDisplay: string;
  gaps: GapRange[];
  gapCount: number;
  unexplainedGapCount: number;
  duplicates: DuplicateInfo[];
  freed: FreedNumber[];
  partners: PartnerStat[];
}

/** Numéro non reconnu par aucune série. */
export interface UnrecognisedNumber {
  raw: string;
  label: string;
  origin: NumberOrigin;
}

/** Résultat complet de l'analyse. */
export interface NumberingAnalysis {
  series: SeriesSummary[];
  unrecognised: UnrecognisedNumber[];
  years: number[];
  totals: { series: number; gaps: number; unexplainedGaps: number; duplicates: number; freed: number; unrecognised: number };
}
