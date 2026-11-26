import type { jsPDF } from "jspdf";
import { formatDA, formatDateTime, formatDate } from "@/utils/format";
import { daysBetween } from "@/utils/dates";
import { LEVEL_WORDS, withExact, type Deck, type DeckPageId } from "@/features/treasury/lib/deck";
import { pdfText } from "@/features/treasury/lib/pdf-text";
import type { RiskLevel } from "@/features/treasury/lib/risk";
import type { TreasuryView } from "@/features/treasury/types/view";

/** Images de la charte (octets PNG), absentes en test. */
export interface DeckAssets {
  logo: Uint8Array | null;
  footer: Uint8Array | null;
}

export type Rgb = [number, number, number];

// Couleurs de la charte Allo Assistance, celles de l'application (globals.css) : violet hsl(287 62% 31%), orange hsl(28 92% 48%), texte hsl(285 40% 13%).
export const VIOLET: Rgb = [107, 30, 128];
export const ORANGE: Rgb = [235, 115, 10];
export const INK: Rgb = [40, 20, 46];
export const BLACK: Rgb = [0, 0, 0];
export const TINT: Rgb = [243, 236, 247];
export const GREY: Rgb = [90, 90, 90];

const PAGE_W = 297;
const PAGE_H = 210;
const MARGIN = 14;
const CONTENT_W = PAGE_W - 2 * MARGIN;
const TOP = 50;
const BOTTOM = 186;
const LOGO_RATIO = 693 / 384;
const FOOTER_RATIO = 619 / 61;

/** Dessinateur : petite surcouche de jsPDF pour le texte latin-1, les cadres et les tableaux. */
export class Pen {
  constructor(readonly doc: jsPDF) {}

  text(value: string, x: number, y: number, opts: { size?: number; bold?: boolean; color?: Rgb; align?: "left" | "center" | "right"; maxWidth?: number } = {}): void {
    this.doc.setFont("helvetica", opts.bold ? "bold" : "normal");
    this.doc.setFontSize(opts.size ?? 10);
    this.doc.setTextColor(...(opts.color ?? BLACK));
    this.doc.text(pdfText(value), x, y, { align: opts.align ?? "left", ...(opts.maxWidth ? { maxWidth: opts.maxWidth } : {}) });
  }

  /** Paragraphe à la largeur donnée ; renvoie le y après la dernière ligne. */
  paragraph(value: string, x: number, y: number, width: number, opts: { size?: number; bold?: boolean; color?: Rgb; lineHeight?: number; maxLines?: number } = {}): number {
    const size = opts.size ?? 10;
    this.doc.setFont("helvetica", opts.bold ? "bold" : "normal");
    this.doc.setFontSize(size);
    let lines = this.doc.splitTextToSize(pdfText(value), width) as string[];
    if (opts.maxLines && lines.length > opts.maxLines) {
      lines = lines.slice(0, opts.maxLines);
      lines[lines.length - 1] = `${(lines[lines.length - 1] ?? "").replace(/\s+\S*$/, "")}...`;
    }
    const step = opts.lineHeight ?? size * 0.44;
    this.doc.setTextColor(...(opts.color ?? BLACK));
    lines.forEach((line, index) => this.doc.text(line, x, y + index * step));
    return y + lines.length * step;
  }

  lineCount(value: string, width: number, size: number, bold = false): number {
    this.doc.setFont("helvetica", bold ? "bold" : "normal");
    this.doc.setFontSize(size);
    return (this.doc.splitTextToSize(pdfText(value), width) as string[]).length;
  }

  box(x: number, y: number, w: number, h: number, opts: { fill?: Rgb; stroke?: Rgb; width?: number } = {}): void {
    if (opts.fill) this.doc.setFillColor(...opts.fill);
    this.doc.setDrawColor(...(opts.stroke ?? BLACK));
    this.doc.setLineWidth(opts.width ?? 0.3);
    this.doc.roundedRect(x, y, w, h, 1.5, 1.5, opts.fill ? (opts.stroke ? "FD" : "F") : "S");
  }

  line(x1: number, y1: number, x2: number, y2: number, opts: { color?: Rgb; width?: number; dash?: number[] } = {}): void {
    this.doc.setDrawColor(...(opts.color ?? BLACK));
    this.doc.setLineWidth(opts.width ?? 0.3);
    this.doc.setLineDashPattern(opts.dash ?? [], 0);
    this.doc.line(x1, y1, x2, y2);
    this.doc.setLineDashPattern([], 0);
  }

  polyline(points: ReadonlyArray<[number, number]>, opts: { color?: Rgb; width?: number; dash?: number[] } = {}): void {
    if (points.length < 2) return;
    this.doc.setDrawColor(...(opts.color ?? BLACK));
    this.doc.setLineWidth(opts.width ?? 0.3);
    this.doc.setLineDashPattern(opts.dash ?? [], 0);
    const [first, ...rest] = points;
    if (!first) return;
    let previous = first;
    for (const point of rest) {
      this.doc.line(previous[0], previous[1], point[0], point[1]);
      previous = point;
    }
    this.doc.setLineDashPattern([], 0);
  }
}

/** Colonne d'un tableau : largeur en mm et alignement. */
export interface Col {
  w: number;
  align?: "left" | "right";
}

/** Tableau simple (en-tête violet, lignes séparées par des filets noirs) ; renvoie le y de fin. Les cellules longues passent à la ligne. */
export function table(pen: Pen, x: number, y: number, cols: Col[], head: string[], rows: string[][], opts: { size?: number; bold?: boolean[] ; footRow?: string[] } = {}): number {
  const size = opts.size ?? 9;
  const pad = 1.8;
  const lineH = size * 0.42;
  const rowHeight = (cells: string[], allBold = false): number => Math.max(...cells.map((cell, i) => pen.lineCount(cell, (cols[i]?.w ?? 20) - 2 * pad, size, Boolean(opts.bold?.[i]) || allBold))) * lineH + 2 * pad - 0.6;
  const drawRow = (cells: string[], top: number, style: { fill?: Rgb; color?: Rgb; bold?: boolean }): number => {
    const height = rowHeight(cells, Boolean(style.bold));
    if (style.fill) {
      pen.doc.setFillColor(...style.fill);
      pen.doc.rect(x, top, cols.reduce((s, c) => s + c.w, 0), height, "F");
    }
    let cx = x;
    cells.forEach((cell, i) => {
      const col = cols[i];
      if (!col) return;
      const tx = col.align === "right" ? cx + col.w - pad : cx + pad;
      pen.doc.setFont("helvetica", style.bold || opts.bold?.[i] ? "bold" : "normal");
      pen.doc.setFontSize(size);
      const lines = pen.doc.splitTextToSize(pdfText(cell), col.w - 2 * pad) as string[];
      pen.doc.setTextColor(...(style.color ?? BLACK));
      lines.forEach((line, k) => pen.doc.text(line, tx, top + pad + lineH * (k + 0.8), { align: col.align === "right" ? "right" : "left" }));
      cx += col.w;
    });
    pen.line(x, top + height, x + cols.reduce((s, c) => s + c.w, 0), top + height, { width: 0.25 });
    return top + height;
  };
  let cursor = drawRow(head, y, { fill: VIOLET, color: [255, 255, 255], bold: true });
  for (const row of rows) cursor = drawRow(row, cursor, {});
  if (opts.footRow) cursor = drawRow(opts.footRow, cursor, { fill: TINT, bold: true });
  return cursor;
}

/** Pictogramme du niveau, forme différente pour chaque niveau (lisible en noir et blanc). */
function drawLevelIcon(pen: Pen, level: RiskLevel, cx: number, cy: number, r: number): void {
  const doc = pen.doc;
  doc.setDrawColor(...BLACK);
  doc.setLineWidth(1.4);
  if (level === "vert") {
    doc.circle(cx, cy, r, "S");
    pen.polyline([[cx - r * 0.5, cy + r * 0.05], [cx - r * 0.12, cy + r * 0.42], [cx + r * 0.55, cy - r * 0.4]], { width: 2.2 });
  } else if (level === "orange") {
    pen.polyline([[cx, cy - r], [cx + r * 1.1, cy + r * 0.85], [cx - r * 1.1, cy + r * 0.85], [cx, cy - r]], { width: 1.4 });
    pen.line(cx, cy - r * 0.35, cx, cy + r * 0.25, { width: 2.2 });
    doc.setFillColor(...BLACK);
    doc.circle(cx, cy + r * 0.6, 0.9, "F");
  } else if (level === "rouge") {
    const pts: Array<[number, number]> = Array.from({ length: 9 }, (_, i) => [cx + r * Math.cos(Math.PI / 8 + (i * Math.PI) / 4), cy + r * Math.sin(Math.PI / 8 + (i * Math.PI) / 4)]);
    pen.polyline(pts, { width: 1.4 });
    pen.line(cx - r * 0.45, cy - r * 0.45, cx + r * 0.45, cy + r * 0.45, { width: 2.2 });
    pen.line(cx - r * 0.45, cy + r * 0.45, cx + r * 0.45, cy - r * 0.45, { width: 2.2 });
  } else {
    doc.circle(cx, cy, r, "S");
    pen.text("?", cx, cy + r * 0.45, { size: r * 3.2, bold: true, align: "center" });
  }
}

const PAGE_FILL: Readonly<Record<RiskLevel, Rgb>> = { vert: [226, 243, 233], orange: [253, 236, 214], rouge: [250, 222, 224], indetermine: [236, 236, 236] };

/** Graphique vectoriel de l'évolution du solde : historique, projection, réserve, zéro, point bas, découvert, saut du solde réel au disponible. */
function drawChart(pen: Pen, view: TreasuryView, x0: number, y0: number, w: number, h: number): void {
  const computation = view.computation;
  if (!computation) return;
  const projection = computation.timeline.points;
  const history = view.history;
  const first = history[0]?.d ?? projection[0]?.date ?? "";
  const last = projection[projection.length - 1]?.date ?? history[history.length - 1]?.d ?? first;
  const span = Math.max(1, daysBetween(first, last));
  const left = x0 + 24;
  const right = x0 + w - 4;
  const top = y0 + 3;
  const bottom = y0 + h - 9;
  const start = projection[0];
  const jump = start && Math.abs(computation.bank - start.balance) >= 0.5 ? { date: start.date, from: computation.bank, to: start.balance } : null;
  const values = [0, computation.cushion, ...(jump ? [jump.from] : []), ...history.map((p) => p.b), ...projection.map((p) => p.balance)];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = (max - min) * 0.08 || 1;
  const yMin = min - pad;
  const yMax = max + pad;
  const X = (date: string): number => left + (daysBetween(first, date) / span) * (right - left);
  const Y = (value: number): number => top + (1 - (value - yMin) / (yMax - yMin)) * (bottom - top);
  for (let i = 0; i < 5; i += 1) {
    const value = yMin + ((yMax - yMin) * i) / 4;
    pen.line(left, Y(value), right, Y(value), { color: [150, 150, 150], width: 0.15 });
    pen.text(`${Math.round(value / 1_000_000)} M`, left - 2, Y(value) + 1, { size: 8, align: "right" });
  }
  pen.line(left, Y(0), right, Y(0), { color: BLACK, width: 0.6 });
  pen.text("Zéro : en dessous, le compte est à découvert", right, Y(0) - 1.2, { size: 8, bold: true, align: "right" });
  if (computation.cushion > 0) {
    pen.line(left, Y(computation.cushion), right, Y(computation.cushion), { color: ORANGE, width: 0.7, dash: [0.8, 1.6] });
    pen.text(`Minimum de trésorerie ${Math.round(computation.cushion / 1_000_000)} M`, left + 2, Y(computation.cushion) - 1.2, { size: 8, bold: true });
  }
  pen.polyline(history.map((p): [number, number] => [X(p.d), Y(p.b)]), { color: VIOLET, width: 0.9 });
  pen.polyline(projection.map((p): [number, number] => [X(p.date), Y(p.balance)]), { color: VIOLET, width: 0.9, dash: [2.4, 1.6] });
  if (jump) {
    pen.line(X(jump.date), Y(jump.from), X(jump.date), Y(jump.to), { color: BLACK, width: 0.9 });
    pen.doc.setFillColor(...BLACK);
    pen.doc.circle(X(jump.date), Y(jump.from), 1.1, "F");
    pen.text(`Solde réel ${Math.round(jump.from / 1_000_000)} M -> disponible ${Math.round(jump.to / 1_000_000)} M`, X(jump.date) + 2.5, (Y(jump.from) + Y(jump.to)) / 2 + 1, { size: 8, bold: true });
  }
  const low = computation.timeline.lowest;
  pen.doc.setFillColor(255, 255, 255);
  pen.doc.setDrawColor(...BLACK);
  pen.doc.setLineWidth(0.9);
  pen.doc.circle(X(low.date), Y(low.balance), 1.8, "FD");
  pen.text(`Point bas ${Math.round(low.balance / 1_000_000)} M (${formatDate(low.date).slice(0, 5)})`, Math.min(X(low.date) + 3, right - 46), Y(low.balance) + 5.5, { size: 8, bold: true });
  if (computation.timeline.overdraftDate) {
    const ox = X(computation.timeline.overdraftDate);
    pen.line(ox, top, ox, bottom, { color: BLACK, width: 0.5, dash: [1.5, 1] });
    pen.text(`Découvert dès le ${formatDate(computation.timeline.overdraftDate).slice(0, 5)}`, Math.min(ox + 2, right - 40), top + 4, { size: 8, bold: true });
  }
  pen.text(formatDate(first), left, bottom + 6, { size: 8 });
  pen.text(formatDate(last), right, bottom + 6, { size: 8, align: "right" });
  pen.line(left, bottom, right, bottom, { width: 0.3 });
}

function legendItem(pen: Pen, x: number, y: number, label: string, kind: "plein" | "tirets" | "points" | "zero"): number {
  if (kind === "plein") pen.line(x, y - 1, x + 10, y - 1, { color: VIOLET, width: 0.9 });
  else if (kind === "tirets") pen.line(x, y - 1, x + 10, y - 1, { color: VIOLET, width: 0.9, dash: [2.4, 1.6] });
  else if (kind === "points") pen.line(x, y - 1, x + 10, y - 1, { color: ORANGE, width: 0.7, dash: [0.8, 1.6] });
  else pen.line(x, y - 1, x + 10, y - 1, { color: BLACK, width: 0.6 });
  pen.text(label, x + 12, y, { size: 8.5 });
  return x + 12 + label.length * 1.75 + 8;
}

/** Barre horizontale : étiquette, barre proportionnelle, montant et part. */
function bar(pen: Pen, x: number, y: number, w: number, share: number, label: string, amount: string, fill: Rgb): void {
  pen.text(label, x, y, { size: 9.5, bold: true });
  const barX = x;
  const barY = y + 2;
  pen.box(barX, barY, w, 6, { stroke: BLACK, width: 0.3 });
  if (share > 0) {
    pen.doc.setFillColor(...fill);
    pen.doc.rect(barX, barY, Math.max(0.8, (w * share) / 100), 6, "F");
    pen.doc.setDrawColor(...BLACK);
    pen.doc.setLineWidth(0.3);
    pen.doc.rect(barX, barY, Math.max(0.8, (w * share) / 100), 6, "S");
  }
  pen.text(`${amount}  (${String(share).replace(".", ",")} %)`, x, y + 12.5, { size: 9 });
}

/**
 * Dessine la présentation PDF (A4 paysage, une page par rubrique) à partir du contenu `Deck` et de la vue (historique du graphique).
 * Papier à en-tête Allo Assistance : logo en haut à gauche, pied de page adresse. Polices standard Helvetica comme les états BDG.
 * Noir et blanc lisible : texte noir, aucun texte pâle, niveaux écrits en toutes lettres, formes distinctes pour les pictogrammes.
 */
export function drawDeck(doc: jsPDF, deck: Deck, view: TreasuryView, assets: DeckAssets, generatedAt: string): void {
  const pen = new Pen(doc);
  const total = deck.pages.length;
  const stamp = `Généré le ${formatDateTime(generatedAt)} (heure d'Alger)`;

  deck.pages.forEach((page, index) => {
    if (index > 0) doc.addPage();
    chrome(page.id, page.title, page.retenir, index + 1);
    body(page.id);
  });

  function chrome(id: DeckPageId, title: string, retenir: string, number: number): void {
    if (id !== "garde") {
      if (assets.logo) doc.addImage(assets.logo, "PNG", MARGIN - 3, 4, 22 * LOGO_RATIO, 22);
      pen.text(title, MARGIN + 40, 17, { size: 20, bold: true, color: VIOLET });
      pen.line(MARGIN, 27, PAGE_W - MARGIN, 27, { color: ORANGE, width: 0.9 });
      if (deck.scenario) pen.text("MODE SIMULATION", PAGE_W - MARGIN, 12, { size: 11, bold: true, align: "right" });
      pen.box(MARGIN, 31, CONTENT_W, 14, { fill: TINT });
      pen.doc.setFillColor(...ORANGE);
      pen.doc.rect(MARGIN, 31, 2.2, 14, "F");
      pen.text("Ce qu'il faut retenir", MARGIN + 6, 36, { size: 8.5, bold: true, color: VIOLET });
      pen.paragraph(retenir, MARGIN + 6, 40.5, CONTENT_W - 10, { size: 10.5, bold: true, maxLines: 2, lineHeight: 4.6 });
    }
    pen.line(MARGIN, 189, PAGE_W - MARGIN, 189, { width: 0.3 });
    pen.text(stamp, MARGIN, 193, { size: 8 });
    pen.text("CONFIDENTIEL - Allo Assistance", PAGE_W / 2, 193, { size: 8, bold: true, align: "center" });
    pen.text(`Page ${number} / ${total}`, PAGE_W - MARGIN, 193, { size: 8, align: "right" });
    if (assets.footer) {
      const width = 105;
      doc.addImage(assets.footer, "PNG", (PAGE_W - width) / 2, PAGE_H - 3 - width / FOOTER_RATIO, width, width / FOOTER_RATIO);
    }
  }

  function body(id: DeckPageId): void {
    switch (id) {
      case "garde":
        return cover();
      case "essentiel":
        return essentiel();
      case "solde":
        return solde();
      case "reste":
        return reste();
      case "evolution":
        return evolution();
      case "paiements":
        return paiements();
      case "simulation":
        return simulation();
      case "cheques":
        return cheques();
      case "hypotheses":
        return hypotheses();
    }
  }

  function cover(): void {
    if (assets.logo) doc.addImage(assets.logo, "PNG", 14, 32, 84, 84 / LOGO_RATIO);
    pen.line(108, 36, 108, 140, { color: ORANGE, width: 1.4 });
    pen.text("Situation de trésorerie", 116, 66, { size: 34, bold: true, color: VIOLET });
    pen.text(deck.cover.subtitle, 116, 80, { size: 14, bold: true });
    pen.text(`Établi le ${formatDate(deck.cover.today)}`, 116, 90, { size: 12 });
    pen.box(116, 100, 92, 16, { stroke: BLACK, width: 1.4 });
    pen.text("CONFIDENTIEL", 162, 111, { size: 20, bold: true, align: "center" });
    pen.text("Administrateur, Direction et Comptable uniquement.", 116, 124, { size: 10 });
    if (deck.scenario) {
      pen.box(116, 130, CONTENT_W - 102, 22, { fill: TINT, stroke: BLACK, width: 1.4 });
      pen.text("MODE SIMULATION", 120, 139, { size: 15, bold: true });
      pen.paragraph(`Scénario « ${deck.scenario.nom} » : ${deck.scenario.lines} ligne(s) simulée(s). Ces chiffres ne sont pas la situation réelle.`, 120, 145.5, CONTENT_W - 110, { size: 10, bold: true, maxLines: 2, lineHeight: 4.4 });
    }
    pen.paragraph("Aide à la décision. L'ordre de paiement relève de la décision de la direction.", 116, 168, 160, { size: 10.5, bold: true });
  }

  function essentiel(): void {
    const e = deck.essentiel;
    const gap = 6;
    const w = (CONTENT_W - 2 * gap) / 3;
    e.kpis.forEach((kpi, i) => {
      const x = MARGIN + (i % 3) * (w + gap);
      const y = TOP + Math.floor(i / 3) * 34;
      pen.box(x, y, w, 30, { stroke: VIOLET, width: 0.6, fill: [255, 255, 255] });
      pen.text(kpi.label, x + 3, y + 6, { size: 9.5, bold: true, color: VIOLET, maxWidth: w - 6 });
      pen.text(kpi.value, x + 3, y + 15, { size: 15, bold: true, maxWidth: w - 6 });
      pen.paragraph(kpi.hint, x + 3, y + 21, w - 6, { size: 8.5, maxLines: 2, lineHeight: 3.6 });
    });
    const y = TOP + 72;
    pen.box(MARGIN, y, CONTENT_W, 60, { fill: PAGE_FILL[e.level], stroke: BLACK, width: 1.6 });
    drawLevelIcon(pen, e.level, MARGIN + 28, y + 30, 15);
    pen.text(`NIVEAU ${e.word}`, MARGIN + 54, y + 20, { size: 30, bold: true });
    pen.text(e.title, MARGIN + 54, y + 29, { size: 14, bold: true, color: VIOLET });
    pen.paragraph(e.sentence, MARGIN + 54, y + 38, CONTENT_W - 62, { size: 12, bold: true, lineHeight: 5.2, maxLines: 5 });
  }

  function solde(): void {
    const s = deck.solde;
    const endFacts = table(pen, MARGIN, TOP, [{ w: 42 }, { w: 72 }, { w: 56 }], ["Information", "Valeur", "Ce que cela veut dire"], s.facts.map(([a, b, c]) => [a, b, c]), { size: 9, bold: [true, true, false] });
    if (s.checks) {
      pen.text("Contrôles de cohérence du relevé", MARGIN, endFacts + 9, { size: 11, bold: true, color: VIOLET });
      table(pen, MARGIN, endFacts + 12, [{ w: 42 }, { w: 22 }, { w: 106 }], ["Contrôle", "Résultat", "Ce qui est vérifié"], s.checks.map((c) => [c.label, c.ok ? "RÉUSSI" : "ÉCHEC", c.explanation]), { size: 9, bold: [true, true, false] });
    } else {
      pen.paragraph("Solde saisi à la main : aucun contrôle de cohérence de relevé n'a pu être fait.", MARGIN, endFacts + 10, 170, { size: 10, bold: true });
    }
    const x = MARGIN + 182;
    const w = CONTENT_W - 182;
    pen.box(x, TOP, w, 50, { fill: s.freshnessLevel === "ok" ? TINT : [253, 236, 214], stroke: BLACK, width: s.freshnessLevel === "ok" ? 0.6 : 1.4 });
    pen.text(s.freshnessLevel === "ok" ? "Fraîcheur du solde" : "ATTENTION - fraîcheur du solde", x + 4, TOP + 8, { size: 11, bold: true, color: VIOLET, maxWidth: w - 8 });
    pen.paragraph(s.freshness, x + 4, TOP + 16, w - 8, { size: 10, bold: true, lineHeight: 4.6 });
    pen.paragraph("Plus le relevé est ancien, moins le solde reflète la réalité : les paiements et encaissements récents n'y figurent pas.", x, TOP + 60, w, { size: 9, lineHeight: 4 });
  }

  function reste(): void {
    const r = deck.reste;
    const left = MARGIN;
    const lw = 120;
    pen.text("Répartition du reste à payer (factures)", left, TOP + 3, { size: 11, bold: true, color: VIOLET });
    const fills: Rgb[] = [VIOLET, ORANGE, [120, 120, 120]];
    r.parts.forEach((part, i) => bar(pen, left, TOP + 12 + i * 21, lw, part.share, `${part.label} - ${part.count} facture${part.count > 1 ? "s" : ""}`, formatDA(part.total), fills[i] ?? GREY));
    pen.text("Ancienneté des factures en attente", left, TOP + 82, { size: 11, bold: true, color: VIOLET });
    table(pen, left, TOP + 85, [{ w: 56 }, { w: 22, align: "right" }, { w: 42, align: "right" }], ["Ancienneté", "Factures", "Montant"], r.aging.map((a) => [a.label, String(a.count), formatDA(a.total)]), { size: 9 });
    const rx = MARGIN + 130;
    pen.text("Les plus gros prestataires en attente", rx, TOP + 3, { size: 11, bold: true, color: VIOLET });
    const end = table(pen, rx, TOP + 6, [{ w: 62 }, { w: 16, align: "right" }, { w: 40, align: "right" }, { w: 21, align: "right" }], ["Prestataire", "Fact.", "Montant", "Plus ancienne"], r.payees.map((p) => [p.name, String(p.count), formatDA(p.total), p.oldestDays === null ? "-" : `${p.oldestDays} j`]), { size: 8.5 });
    if (r.othersCount > 0) pen.text(`et ${r.othersCount} autre${r.othersCount > 1 ? "s" : ""} prestataire${r.othersCount > 1 ? "s" : ""}.`, rx, end + 5, { size: 9 });
    pen.text(`Total du reste à payer : ${formatDA(r.total)}`, rx, Math.min(end + 14, BOTTOM - 2), { size: 11, bold: true });
  }

  function evolution(): void {
    const c = view.computation;
    drawChart(pen, view, MARGIN, TOP, CONTENT_W, 104);
    let lx = MARGIN + 24;
    lx = legendItem(pen, lx, TOP + 112, "Solde réel (relevé)", "plein");
    lx = legendItem(pen, lx, TOP + 112, "Solde prévu, sans encaissement", "tirets");
    lx = legendItem(pen, lx, TOP + 112, "Minimum de trésorerie", "points");
    legendItem(pen, lx, TOP + 112, "Zéro", "zero");
    if (!c) return;
    pen.paragraph("Lecture : la ligne pleine est le solde réel du compte jusqu'au relevé ; le pointillé est le solde prévu si l'on règle chaque facture et chaque obligation à la date indiquée, sans compter aucun encaissement.", MARGIN, TOP + 121, CONTENT_W, { size: 9.5, lineHeight: 4.2 });
    pen.paragraph(c.timeline.overdraftDate ? `Alerte : le solde passe sous zéro le ${formatDate(c.timeline.overdraftDate)}.` : `Le solde le plus bas, ${withExact(c.timeline.lowest.balance)}, est atteint le ${formatDate(c.timeline.lowest.date)} ; il ${c.timeline.lowest.balance < c.cushion ? "reste inférieur au" : "reste supérieur au"} minimum de trésorerie de ${withExact(c.cushion)}.`, MARGIN, TOP + 132, CONTENT_W, { size: 9.5, bold: true, lineHeight: 4.2 });
  }

  function paiements(): void {
    const p = deck.paiements;
    pen.text("Par nature de paiement", MARGIN, TOP + 3, { size: 11, bold: true, color: VIOLET });
    table(pen, MARGIN, TOP + 6, [{ w: 90 }, { w: 22, align: "right" }, { w: 44, align: "right" }, { w: 20, align: "right" }], ["Nature", "Nombre", "Montant", "Part"], p.groups.map((g) => [g.label, String(g.count), formatDA(g.total), `${String(g.share).replace(".", ",")} %`]), { size: 9.5, footRow: ["TOTAL À PAYER", String(p.groups.reduce((s, g) => s + g.count, 0)), formatDA(p.total), "100 %"] });
    const x = MARGIN + 188;
    const w = CONTENT_W - 188;
    pen.text("Ordre de paiement conseillé", x, TOP + 3, { size: 11, bold: true, color: VIOLET });
    let y = TOP + 10;
    p.order.forEach((group, i) => {
      pen.text(`${i + 1}.`, x, y, { size: 9.5, bold: true });
      y = pen.paragraph(`${group.label} : ${group.count} paiement${group.count > 1 ? "s" : ""}, ${withExact(group.total)}`, x + 6, y, w - 6, { size: 9, lineHeight: 3.9 }) + 2.6;
    });
    let ny = TOP + 62;
    for (const note of p.notes) ny = pen.paragraph(`- ${note}`, MARGIN, ny, 176, { size: 9.5, lineHeight: 4.1 }) + 2.5;
    pen.box(MARGIN, 168, CONTENT_W, 12, { stroke: BLACK, width: 1 });
    pen.text(p.mention, PAGE_W / 2, 175.5, { size: 10.5, bold: true, align: "center" });
  }

  function simulation(): void {
    const s = deck.simulation;
    if (!s) return;
    const shown = s.lines.slice(0, 11);
    const end = table(pen, MARGIN, TOP, [{ w: 34 }, { w: 82 }, { w: 24 }, { w: 40, align: "right" }, { w: 26 }, { w: 24 }, { w: 30 }], ["Type", "Libellé", "Date", "Montant", "Mode", "Certitude", "Compté ?"], shown.map((l) => [l.type, l.libelle, l.date, formatDA(l.montant), l.mode, l.certitude, l.counted ? "oui" : "non (écarté)"]), { size: 8.5 });
    if (s.lines.length > shown.length) pen.text(`et ${s.lines.length - shown.length} autre(s) ligne(s) du scénario.`, MARGIN, end + 4, { size: 9 });
    const y = end + (s.lines.length > shown.length ? 12 : 9);
    const w = (CONTENT_W - 12) / 3;
    const tiles: Array<[string, string, string]> = [
      ["Avant la simulation", formatDA(s.before), s.coverageBefore === null ? "" : `couverture ${s.coverageBefore.toFixed(1).replace(".", ",")} jours`],
      ["Lignes simulées retirées", formatDA(s.total), "hypothèses de la comptable"],
      ["Après la simulation", formatDA(s.after), s.coverageAfter === null ? "" : `couverture ${s.coverageAfter.toFixed(1).replace(".", ",")} jours`],
    ];
    tiles.forEach(([label, value, hint], i) => {
      const x = MARGIN + i * (w + 6);
      pen.box(x, y, w, 26, { stroke: i === 2 ? BLACK : VIOLET, width: i === 2 ? 1.4 : 0.6 });
      pen.text(label, x + 3, y + 6, { size: 9.5, bold: true, color: VIOLET });
      pen.text(value, x + 3, y + 15, { size: 14, bold: true, maxWidth: w - 6 });
      pen.text(hint, x + 3, y + 22, { size: 8.5 });
    });
    if (s.duplicates) pen.paragraph(`ATTENTION : ${s.duplicates}`, MARGIN, y + 33, CONTENT_W, { size: 9.5, bold: true, lineHeight: 4.2, maxLines: 2 });
  }

  function cheques(): void {
    const c = deck.cheques;
    pen.text("Chèques émis, pas encore débités par la banque (déduits du solde)", MARGIN, TOP + 3, { size: 11, bold: true, color: VIOLET });
    const rows = c.circulation.slice(0, 6);
    let end = TOP + 6;
    if (rows.length > 0) end = table(pen, MARGIN, TOP + 6, [{ w: 26 }, { w: 60 }, { w: 22 }, { w: 40, align: "right" }], ["N° du chèque", "Bénéficiaire", "Émis le", "Montant"], rows.map((r) => [r.numero, r.beneficiaire, r.date, formatDA(r.montant)]), { size: 8.5, footRow: ["TOTAL", "", "", formatDA(c.total)] });
    else pen.text("Aucun chèque en circulation.", MARGIN, TOP + 12, { size: 10, bold: true });
    if (c.circulation.length > rows.length) pen.text(`et ${c.circulation.length - rows.length} autre(s) chèque(s).`, MARGIN, end + 4, { size: 8.5 });
    const vy = Math.max(end + 11, 112);
    pen.text("Chèques à vérifier (non déduits : sans date ou trop anciens)", MARGIN, vy, { size: 11, bold: true, color: VIOLET });
    const vr = c.toVerify.slice(0, 5);
    if (vr.length > 0) table(pen, MARGIN, vy + 3, [{ w: 26 }, { w: 60 }, { w: 22 }, { w: 40, align: "right" }], ["N° du chèque", "Bénéficiaire", "Date", "Montant"], vr.map((r) => [r.numero, r.beneficiaire, r.date, formatDA(r.montant)]), { size: 8.5 });
    else pen.text("Aucun.", MARGIN, vy + 7, { size: 10 });
    if (c.toVerify.length > vr.length) pen.text(`et ${c.toVerify.length - vr.length} autre(s) chèque(s) à vérifier.`, MARGIN, BOTTOM - 1, { size: 8.5 });
    const x = MARGIN + 164;
    const w = CONTENT_W - 164;
    pen.text("Points de contrôle", x, TOP + 3, { size: 11, bold: true, color: VIOLET });
    let y = TOP + 10;
    for (const point of c.points.slice(0, 8)) {
      pen.text("-", x, y, { size: 9, bold: true });
      y = pen.paragraph(point, x + 4, y, w - 4, { size: 8.8, lineHeight: 3.8, maxLines: 4 }) + 2.4;
    }
  }

  function hypotheses(): void {
    const h = deck.hypotheses;
    const colW = (CONTENT_W - 8) / 2;
    pen.text("Lire chaque chiffre", MARGIN, TOP + 3, { size: 11, bold: true, color: VIOLET });
    let y = TOP + 9;
    for (const [term, definition] of h.definitions) {
      pen.text(term, MARGIN, y, { size: 9, bold: true });
      y = pen.paragraph(definition, MARGIN + 44, y, colW - 44, { size: 8.6, lineHeight: 3.6 }) + 2.3;
    }
    const x = MARGIN + colW + 8;
    pen.text("Ce qui est compté", x, TOP + 3, { size: 11, bold: true, color: VIOLET });
    let ry = TOP + 9;
    for (const item of h.counted) ry = pen.paragraph(`+ ${item}`, x, ry, colW, { size: 8.8, lineHeight: 3.7 }) + 1.6;
    ry += 3;
    pen.text("Ce qui n'est pas compté", x, ry, { size: 11, bold: true, color: VIOLET });
    ry += 6;
    for (const item of h.notCounted) ry = pen.paragraph(`- ${item}`, x, ry, colW, { size: 8.8, lineHeight: 3.7 }) + 1.6;
    pen.box(MARGIN, 172, CONTENT_W, 11, { stroke: BLACK, width: 1 });
    pen.text(h.mention, PAGE_W / 2, 179, { size: 10.5, bold: true, align: "center" });
  }
}
