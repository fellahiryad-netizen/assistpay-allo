import { REGUL_LABELS, REGUL_MOIS } from "@/features/regul/services/regul-engine";
import { STATUT_LABELS, type PoliceRow, type PolicesView } from "@/features/regul/services/regul-polices";
import type { TableSheet } from "@/lib/spreadsheet";

const mois = (m: number): string => REGUL_MOIS[m - 1] ?? String(m);
const oui = (v: boolean | null): string => (v === null ? "Base sinistres absente" : v ? "Oui" : "Non");
const DETAIL_HEAD = ["Succursale", "Code agence", "Agence", "Mois", "Police", "Immatriculation", "Garantie", "Part assisteur", "Origine", "Statut", "Réapparition", "Annulée", "Sinistre", "Remarque"];
const DETAIL_WIDTHS = [14, 11, 28, 11, 22, 18, 18, 14, 12, 16, 18, 9, 14, 30];
const detailRow = (x: PoliceRow): Array<string | number | null> => [
  REGUL_LABELS[x.succ] ?? x.succ,
  x.code,
  x.agence,
  mois(x.mois),
  x.police,
  x.immat,
  x.garantie,
  x.pa,
  x.source === "base" ? "Avance 90 %" : "Régularisation",
  x.statut ? STATUT_LABELS[x.statut] : "",
  x.reapparition.length ? `${x.reapparition.map(mois).join(", ")} (${x.reapparitionSource === "regul" ? "régul" : "avance"})` : "",
  x.annulee ? "Oui" : "Non",
  oui(x.sinistre),
  x.remarque,
];

/** Feuilles du classeur « polices » construites depuis le croisement (fonction pure, testable). */
export function buildPolicesSheets(view: PolicesView): TableSheet[] {
  const detail = (name: string, rows: PoliceRow[]): TableSheet => ({ name, header: DETAIL_HEAD, rows: rows.map(detailRow), widths: DETAIL_WIDTHS, amountCols: [7] });
  const all = (pick: (b: PolicesView["blocks"][number]) => PoliceRow[]): PoliceRow[] => view.blocks.flatMap(pick);
  const sumHead = ["Succursale", "Polices avance absentes de la régul", "dont reportées", "dont reportées probables", "dont annulées", "dont introuvables", "Polices annulées", "Polices avec sinistre", "Annulées + sinistre", "Mois sans régul conservée"];
  const synth: TableSheet = {
    name: "Synthèse",
    header: sumHead,
    rows: view.blocks.map((b) => {
      const c = b.agences;
      const n = (f: (x: (typeof c)[number]) => number): number => c.reduce((a, x) => a + f(x), 0);
      return [REGUL_LABELS[b.result.succ] ?? b.result.succ, n((x) => x.absentes), n((x) => x.reportees), n((x) => x.reporteesProbables), n((x) => x.annulees), n((x) => x.introuvables), n((x) => x.annuleesTotal), n((x) => x.sinistrees), n((x) => x.annuleesSinistre), b.result.moisSansRegul.map(mois).join(", ")];
    }),
    widths: [16, 22, 14, 18, 14, 16, 16, 18, 18, 30],
    totalLabel: "TOTAL",
    sumCols: [1, 2, 3, 4, 5, 6, 7, 8],
  };
  const agHead = ["Succursale", "Code agence", "Agence", "Absentes de la régul", "Reportées", "Reportées probables", "Annulées (absentes)", "Introuvables", "Polices annulées", "Avec sinistre", "Annulées + sinistre"];
  const agSheet: TableSheet = {
    name: "Synthèse agences",
    header: agHead,
    rows: view.blocks.flatMap((b) => b.agences.map((a) => [REGUL_LABELS[a.succ] ?? a.succ, a.code, a.agence, a.absentes, a.reportees, a.reporteesProbables, a.annulees, a.introuvables, a.annuleesTotal, a.sinistrees, a.annuleesSinistre])),
    widths: [16, 11, 28, 18, 12, 18, 18, 14, 16, 14, 18],
    totalLabel: "TOTAL",
    sumCols: [3, 4, 5, 6, 7, 8, 9, 10],
  };
  const perSucc = view.blocks.map((b) => {
    const seen = new Map<string, PoliceRow>();
    for (const x of [...b.result.absentes, ...b.result.annulees, ...b.result.sinistrees]) {
      const k = `${x.mois}|${x.code}|${x.police}|${x.immat.replace(/[ \-.]/g, "").toUpperCase()}`;
      if (!seen.has(k)) seen.set(k, x);
    }
    const rows = [...seen.values()].sort((p, q) => p.code - q.code || p.mois - q.mois || (p.police < q.police ? -1 : p.police > q.police ? 1 : 0));
    return detail(REGUL_LABELS[b.result.succ] ?? b.result.succ, rows);
  });
  return [
    synth,
    agSheet,
    ...perSucc,
    detail("Non retrouvées", all((b) => b.result.absentes)),
    detail("Reportées", all((b) => b.result.absentes.filter((x) => x.statut === "REPORTEE" || x.statut === "REPORTEE_PROBABLE"))),
    detail("Annulées", all((b) => b.result.annulees)),
    detail("Sinistrées", all((b) => b.result.sinistrees)),
    detail("Annulées+sinistre", all((b) => b.result.annuleesSinistre)),
  ];
}

