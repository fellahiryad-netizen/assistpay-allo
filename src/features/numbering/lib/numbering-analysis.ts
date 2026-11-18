/**
 * Analyse en lecture seule des numéros de factures : séries, trous, doublons, numéros de factures supprimées.
 * Cette fonction ne génère aucun numéro et ne reproduit aucune règle de calcul : elle observe ce qui existe.
 * Les formats reconnus sont ceux que produisent les générateurs actuels (billing-calc.ts, avoir-calc.ts).
 */
import {
  SERIES_LABELS,
  type DeletionInfo,
  type DeletionTrace,
  type DocRef,
  type DuplicateInfo,
  type FreedNumber,
  type GapRange,
  type NumberSource,
  type NumberingAnalysis,
  type ParsedNumber,
  type PartnerStat,
  type SeriesKind,
  type SeriesSummary,
  type UnrecognisedNumber,
} from "@/features/numbering/types";

/** Les générateurs actuels ignorent les numéros de la suite commune à partir de 5000 (reprises d'historique). */
const FACT_SEQ_LIMIT = 5000;

const KIND_ORDER: readonly SeriesKind[] = ["FACT", "AB", "TRUST_BDG", "CAAT_BDG", "AVOIR"];

interface Hit {
  year: number;
  seq: number;
  prefix: string;
}

interface Rule {
  kind: SeriesKind;
  pattern: RegExp;
  read: (match: RegExpMatchArray) => Hit[];
}

const num = (value: string | undefined): number => Number(value ?? "0");

const RULES: readonly Rule[] = [
  { kind: "AVOIR", pattern: /AV\/(\d{4})\/(\d{3,})/g, read: (m) => [{ year: num(m[1]), seq: num(m[2]), prefix: "AV" }] },
  { kind: "TRUST_BDG", pattern: /TRUST\s*0*(\d{1,6})\s*[-/ ]\s*(\d{4})\s*BDG/gi, read: (m) => [{ year: num(m[2]), seq: num(m[1]), prefix: "TRUST" }] },
  { kind: "AB", pattern: /(?<!\d)0*(\d{1,6})\s*[-/ ]?\s*(20\d{2})\s*AB\b/gi, read: (m) => [{ year: num(m[2]), seq: num(m[1]), prefix: "" }] },
  { kind: "AB", pattern: /\bAB\s*0*(\d{1,6})\s*[-/]\s*(20\d{2})/gi, read: (m) => [{ year: num(m[2]), seq: num(m[1]), prefix: "" }] },
  {
    kind: "CAAT_BDG",
    pattern: /(?<!\d)(\d{2})\s*-\s*0*(\d{1,6})\s*(?:&\s*0*(\d{1,6})\s*)?BDG/gi,
    read: (m) => {
      const hits: Hit[] = [{ year: 2000 + num(m[1]), seq: num(m[2]), prefix: "CAAT" }];
      if (m[3]) hits.push({ year: 2000 + num(m[1]), seq: num(m[3]), prefix: "CAAT" });
      return hits;
    },
  },
  {
    kind: "FACT",
    pattern: /(?<![A-Za-z0-9])([A-Za-z]{2,12})\s*(\d{2})\s*-\s*0*(\d{1,6})(?![\d&])(?!\s*BDG)/g,
    read: (m) => (num(m[3]) < FACT_SEQ_LIMIT ? [{ year: 2000 + num(m[2]), seq: num(m[3]), prefix: (m[1] ?? "").toUpperCase() }] : []),
  },
];

/**
 * Reconnaît tous les numéros d'un texte (un numéro isolé, « n° 1 & n° 2 », ou une ligne de journal).
 * Un numéro de suite commune doit porter un préfixe en lettres et un tiret (« GAM 26-000057 », « CAAR26-000012 »).
 */
export function parseNumbers(text: string): ParsedNumber[] {
  const source = text.replace(/\s+/g, " ");
  const consumed: Array<[number, number]> = [];
  const found: ParsedNumber[] = [];
  for (const rule of RULES) {
    for (const match of source.matchAll(rule.pattern)) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      if (consumed.some(([a, b]) => start < b && end > a)) continue;
      consumed.push([start, end]);
      for (const hit of rule.read(match)) {
        if (hit.seq > 0) found.push({ kind: rule.kind, year: hit.year, seq: hit.seq, prefix: hit.prefix, text: match[0].trim() });
      }
    }
  }
  return found;
}

/** Écrit un numéro de série (sans préfixe de partenaire pour la suite commune). */
export function formatSeriesNumber(kind: SeriesKind, year: number, seq: number): string {
  const yy = String(year).slice(2);
  const six = String(seq).padStart(6, "0");
  switch (kind) {
    case "FACT":
      return `${yy}-${six}`;
    case "AB":
      return `${six}-${year} AB`;
    case "TRUST_BDG":
      return `TRUST ${six}-${year} BDG`;
    case "CAAT_BDG":
      return `CAAT ${yy}-${six}BDG`;
    case "AVOIR":
      return `AV/${year}/${String(seq).padStart(4, "0")}`;
  }
}

/** Motif d'une suppression, lu à la fin d'une ligne de journal (« … – motif : texte »). */
export function extractMotif(text: string): string | undefined {
  const match = /motif\s*:\s*(.+)$/i.exec(text.trim());
  const motif = match?.[1]?.trim();
  return motif ? motif : undefined;
}

interface Slot {
  seq: number;
  docs: Map<string, DocRef>;
  prefixes: Map<string, string>;
}

interface SeriesState {
  kind: SeriesKind;
  year: number;
  slots: Map<number, Slot>;
  deleted: Map<number, DeletionInfo>;
}

function stateOf(map: Map<string, SeriesState>, kind: SeriesKind, year: number): SeriesState {
  const key = `${kind}:${year}`;
  let state = map.get(key);
  if (!state) {
    state = { kind, year, slots: new Map(), deleted: new Map() };
    map.set(key, state);
  }
  return state;
}

function compressGaps(state: SeriesState, first: number, last: number): GapRange[] {
  const ranges: GapRange[] = [];
  for (let seq = 1; seq < last; seq += 1) {
    if (state.slots.has(seq)) continue;
    const explained = state.deleted.has(seq);
    const tail = ranges[ranges.length - 1];
    if (tail && tail.to === seq - 1 && tail.explained === explained) {
      tail.to = seq;
      tail.count += 1;
      tail.toDisplay = formatSeriesNumber(state.kind, state.year, seq);
    } else {
      const display = formatSeriesNumber(state.kind, state.year, seq);
      ranges.push({ from: seq, to: seq, count: 1, fromDisplay: display, toDisplay: display, explained, beforeFirst: seq < first });
    }
  }
  return ranges;
}

function summarise(state: SeriesState): SeriesSummary {
  const seqs = [...state.slots.keys()].sort((a, b) => a - b);
  const first = seqs[0] ?? 0;
  const last = seqs[seqs.length - 1] ?? 0;
  const gaps = compressGaps(state, first, last);
  const documents = new Set<string>();
  const duplicates: DuplicateInfo[] = [];
  const partnerMap = new Map<string, PartnerStat>();
  for (const seq of seqs) {
    const slot = state.slots.get(seq);
    if (!slot) continue;
    for (const key of slot.docs.keys()) documents.add(key);
    if (slot.docs.size > 1) duplicates.push({ seq, display: formatSeriesNumber(state.kind, state.year, seq), docs: [...slot.docs.values()] });
    if (state.kind === "FACT") {
      for (const prefix of slot.prefixes.keys()) {
        const stat = partnerMap.get(prefix) ?? { prefix, count: 0, lastSeq: 0, lastDisplay: "" };
        stat.count += 1;
        if (seq > stat.lastSeq) {
          stat.lastSeq = seq;
          stat.lastDisplay = slot.prefixes.get(prefix) ?? formatSeriesNumber(state.kind, state.year, seq);
        }
        partnerMap.set(prefix, stat);
      }
    }
  }
  const freed: FreedNumber[] = [...state.deleted.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([seq, deletion]) => ({
      seq,
      display: formatSeriesNumber(state.kind, state.year, seq),
      status: state.slots.has(seq) ? "reutilise" : seq > last ? "libre_reprise" : "libre_trou",
      deletion,
    }));
  const gapCount = gaps.reduce((sum, range) => sum + range.count, 0);
  const unexplainedGapCount = gaps.filter((range) => !range.explained && !range.beforeFirst).reduce((sum, range) => sum + range.count, 0);
  const beforeFirstGapCount = gaps.filter((range) => !range.explained && range.beforeFirst).reduce((sum, range) => sum + range.count, 0);
  return {
    key: `${state.kind}:${state.year}`,
    kind: state.kind,
    year: state.year,
    label: SERIES_LABELS[state.kind],
    count: seqs.length,
    documents: documents.size,
    first,
    last,
    lastDisplay: last ? formatSeriesNumber(state.kind, state.year, last) : "—",
    nextSeq: last + 1,
    nextDisplay: formatSeriesNumber(state.kind, state.year, last + 1),
    gaps,
    gapCount,
    unexplainedGapCount,
    beforeFirstGapCount,
    duplicates,
    freed,
    entries: seqs.flatMap((seq) => {
      const slot = state.slots.get(seq);
      return slot ? [{ seq, display: formatSeriesNumber(state.kind, state.year, seq), docs: [...slot.docs.values()].map((doc) => ({ raw: doc.raw, label: doc.label })) }] : [];
    }),
    partners: [...partnerMap.values()].sort((a, b) => b.count - a.count || a.prefix.localeCompare(b.prefix, "fr")),
  };
}

/**
 * Analyse les numéros existants et les numéros de factures supprimées.
 * - un numéro est un doublon seulement s'il est porté par deux documents différents (une facture du suivi et sa
 *   facture établie comptent pour un seul document) ;
 * - un trou est un numéro absent entre 1 et le dernier numéro de la série ;
 * - un numéro supprimé est « libre » s'il n'est plus porté par personne : « reprise » s'il dépasse le dernier numéro
 *   (le générateur actuel le redonnera tout seul à la prochaine facture), « trou » sinon.
 */
export function analyseNumbering(sources: readonly NumberSource[], deletions: readonly DeletionTrace[]): NumberingAnalysis {
  const states = new Map<string, SeriesState>();
  const unrecognised: UnrecognisedNumber[] = [];
  for (const source of sources) {
    const raw = source.raw.trim();
    if (!raw) continue;
    const parsed = parseNumbers(raw);
    if (parsed.length === 0) {
      unrecognised.push({ raw, label: source.label, origin: source.origin });
      continue;
    }
    for (const item of parsed) {
      const state = stateOf(states, item.kind, item.year);
      const slot = state.slots.get(item.seq) ?? { seq: item.seq, docs: new Map<string, DocRef>(), prefixes: new Map<string, string>() };
      if (!slot.docs.has(source.docKey)) slot.docs.set(source.docKey, { docKey: source.docKey, label: source.label, origin: source.origin, raw });
      if (item.prefix && !slot.prefixes.has(item.prefix)) slot.prefixes.set(item.prefix, item.text);
      state.slots.set(item.seq, slot);
    }
  }
  for (const trace of deletions) {
    for (const item of parseNumbers(trace.text)) {
      const state = stateOf(states, item.kind, item.year);
      const previous = state.deleted.get(item.seq);
      const at = trace.at ?? null;
      if (previous && (previous.at ?? "") >= (at ?? "")) continue;
      state.deleted.set(item.seq, { at, by: trace.by ?? null, motif: trace.motif ?? null, origin: trace.origin });
    }
  }
  const series = [...states.values()]
    .map(summarise)
    .sort((a, b) => b.year - a.year || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
  const years = [...new Set(series.map((item) => item.year))].sort((a, b) => b - a);
  return {
    series,
    unrecognised,
    years,
    totals: {
      series: series.length,
      gaps: series.reduce((sum, item) => sum + item.gapCount, 0),
      unexplainedGaps: series.reduce((sum, item) => sum + item.unexplainedGapCount, 0),
      beforeFirstGaps: series.reduce((sum, item) => sum + item.beforeFirstGapCount, 0),
      duplicates: series.reduce((sum, item) => sum + item.duplicates.length, 0),
      freed: series.reduce((sum, item) => sum + item.freed.filter((entry) => entry.status !== "reutilise").length, 0),
      unrecognised: unrecognised.length,
    },
  };
}

/** Clé de rapprochement « numéro + client » : casse et espaces ignorés. */
export function pairingKey(num: string, client: string): string {
  const clean = (text: string): string => text.trim().replace(/\s+/g, " ").toLowerCase();
  return `${clean(num)}|${clean(client)}`;
}

/** Index numéro + client → identifiant de la facture du suivi ; une clé portée par plusieurs factures est écartée (rapprochement non sûr). */
export function buildPairingIndex(invoices: ReadonlyArray<{ legacyId: string; numbers: readonly string[]; tiers: string }>): Map<string, string | null> {
  const index = new Map<string, string | null>();
  for (const invoice of invoices) {
    for (const num of invoice.numbers) {
      if (!num.trim() || !invoice.tiers.trim()) continue;
      const key = pairingKey(num, invoice.tiers);
      const known = index.get(key);
      index.set(key, known === undefined || known === invoice.legacyId ? invoice.legacyId : null);
    }
  }
  return index;
}

/** Identifiant de la facture du suivi portant ce numéro pour ce client, seulement si la correspondance est unique. */
export function pairedInvoice(index: ReadonlyMap<string, string | null>, num: string, client: string): string | null {
  if (!num.trim() || !client.trim()) return null;
  return index.get(pairingKey(num, client)) ?? null;
}
