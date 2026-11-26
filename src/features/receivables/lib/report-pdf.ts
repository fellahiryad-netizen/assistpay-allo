import type { jsPDF } from "jspdf";
import { BLACK, GREY, ORANGE, Pen, TINT, VIOLET, table, type Col, type Rgb } from "@/features/treasury/lib/deck-pdf";
import { agingLabelOf } from "@/features/receivables/lib/detail";
import { monthName } from "@/features/receivables/lib/report-mail";
import { branchHeadline, millions, type ImpayesReport, type ReportBranch, type ReportInvoice } from "@/features/receivables/lib/report";
import { formatDA, formatDate, formatDateTime } from "@/utils/format";

/** Images de la charte et logo de la compagnie (octets PNG), absents en test. */
export interface ReportAssets {
  logo: Uint8Array | null;
  footer: Uint8Array | null;
  company: Uint8Array | null;
}

const PAGE_W = 297;
const PAGE_H = 210;
const MARGIN = 14;
const CONTENT_W = PAGE_W - 2 * MARGIN;
const LOGO_RATIO = 693 / 384;
const FOOTER_RATIO = 619 / 61;
/** Lignes de facture par page d'annexe. */
const ROWS_PER_PAGE = 11;
/** Rouge des mois non réglés (doublé d'un libellé « impayé » pour rester lisible en noir et blanc). */
const RED: Rgb = [200, 20, 20];

const SLICES: Rgb[] = [VIOLET, ORANGE, [60, 60, 60], [160, 100, 180], [245, 170, 90], [130, 130, 130], [205, 175, 220], [250, 210, 160]];
const pct = (value: number): string => `${value.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;

interface PageSpec {
  title: string;
  retenir: string;
  draw: () => void;
}

/** Donut vectoriel : secteurs tracés par petits triangles, trou central blanc. */
function donut(pen: Pen, cx: number, cy: number, radius: number, hole: number, values: readonly number[]): void {
  const doc = pen.doc;
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return;
  let start = -Math.PI / 2;
  values.forEach((value, index) => {
    const sweep = (value / total) * Math.PI * 2;
    const steps = Math.max(2, Math.ceil((sweep * 180) / Math.PI));
    doc.setFillColor(...(SLICES[index % SLICES.length] ?? BLACK));
    doc.setDrawColor(...(SLICES[index % SLICES.length] ?? BLACK));
    doc.setLineWidth(0.15);
    for (let step = 0; step < steps; step += 1) {
      const a1 = start + (sweep * step) / steps;
      const a2 = start + (sweep * (step + 1)) / steps + 0.004;
      doc.triangle(cx, cy, cx + radius * Math.cos(a1), cy + radius * Math.sin(a1), cx + radius * Math.cos(a2), cy + radius * Math.sin(a2), "FD");
    }
    start += sweep;
  });
  // Séparateurs blancs entre les secteurs, puis trou central.
  let angle = -Math.PI / 2;
  for (const value of values) {
    pen.line(cx, cy, cx + radius * Math.cos(angle), cy + radius * Math.sin(angle), { color: [255, 255, 255], width: 0.8 });
    angle += (value / total) * Math.PI * 2;
  }
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(255, 255, 255);
  doc.circle(cx, cy, hole, "FD");
}

/** Carte d'indicateur : valeur en grand, libellé et précision dessous. */
function kpi(pen: Pen, x: number, y: number, w: number, label: string, value: string, note: string, accent: Rgb): void {
  pen.box(x, y, w, 30, { fill: TINT });
  pen.doc.setFillColor(...accent);
  pen.doc.rect(x, y, 2.2, 30, "F");
  pen.text(label, x + 6, y + 7, { size: 9, bold: true, color: VIOLET });
  pen.text(value, x + 6, y + 18, { size: 19, bold: true, maxWidth: w - 8 });
  pen.text(note, x + 6, y + 25.5, { size: 8.5, color: GREY, maxWidth: w - 8 });
}

/** Barres horizontales : une par tranche d'ancienneté, avec montant, nombre et part. */
function agingBars(pen: Pen, x: number, y: number, w: number, report: ImpayesReport): void {
  const max = Math.max(1, ...report.aging.map((item) => item.amount));
  const labelW = 30;
  const valueW = 62;
  const barW = w - labelW - valueW;
  report.aging.forEach((item, index) => {
    const top = y + index * 16;
    pen.text(item.label, x, top + 8, { size: 10, bold: true });
    pen.box(x + labelW, top + 2, barW, 9, { fill: [240, 240, 240] });
    const filled = (item.amount / max) * barW;
    if (filled > 0.5) {
      pen.doc.setFillColor(...(item.key === "D90_PLUS" ? ORANGE : item.key === "SANS_DATE" ? ([130, 130, 130] as Rgb) : VIOLET));
      pen.doc.roundedRect(x + labelW, top + 2, Math.max(filled, 1.6), 9, 1.5, 1.5, "F");
    }
    pen.text(millions(item.amount), x + w, top + 6.2, { size: 10, bold: true, align: "right" });
    pen.text(`${item.count} facture(s) · ${pct(item.share)}`, x + w, top + 10.6, { size: 8.5, color: GREY, align: "right" });
  });
}

const invoiceCols: Col[] = [
  { w: 44 },
  { w: 40 },
  { w: 72 },
  { w: 26 },
  { w: 24, align: "right" },
  { w: 30 },
  { w: 41, align: "right" },
];
const invoiceHead = ["N° de facture", "Mois impayé", "Libellé", "Date", "Ancienneté", "Dernière relance", "Montant"];

/** Mois de la facture en toutes lettres, suivi de « impayé » ; « Mois non indiqué » si la période manque. */
function unpaidMonth(invoice: ReportInvoice): string {
  const name = monthName(invoice.periode);
  return name ? `${name} (impayé)` : "Mois non indiqué";
}

function invoiceRows(invoices: readonly ReportInvoice[]): string[][] {
  return invoices.map((invoice) => [
    invoice.numero || "sans n°",
    unpaidMonth(invoice),
    invoice.libelle || "-",
    invoice.date ? formatDate(invoice.date) : "Sans date",
    invoice.ageDays === null ? "-" : `${invoice.ageDays} j`,
    invoice.lastReminder ? formatDate(invoice.lastReminder) : "Aucune",
    formatDA(invoice.amount),
  ]);
}

/** Mois impayés distincts d'une succursale, du plus ancien au plus récent. */
function unpaidMonths(branch: ReportBranch): string[] {
  return [...new Set(branch.invoices.map((invoice) => invoice.periode).filter((key) => monthName(key) !== ""))].sort().map(monthName);
}

/** Bandeau d'en-tête de succursale, comme dans le CRM : nom, nombre, part, plus ancienne, dernière relance, montant, puis mois impayés en rouge. */
function branchHeader(pen: Pen, branch: ReportBranch, y: number): number {
  pen.doc.setFillColor(...TINT);
  pen.doc.rect(MARGIN, y, CONTENT_W, 17, "F");
  pen.text(branch.label, MARGIN + 3, y + 6.5, { size: 12, bold: true, color: VIOLET });
  const facts = [`${branch.count} facture(s)`, pct(branch.share)];
  if (branch.oldestDays !== null) facts.push(`la plus ancienne : ${branch.oldestDays} j`);
  facts.push(branch.lastReminder ? `dernière relance : ${formatDate(branch.lastReminder)}` : "aucune relance connue");
  pen.text(facts.join("  ·  "), MARGIN + 3, y + 12.8, { size: 8.5, color: GREY });
  pen.text(formatDA(branch.amount), MARGIN + CONTENT_W - 3, y + 7, { size: 12, bold: true, align: "right" });
  const months = unpaidMonths(branch);
  pen.text(months.length > 0 ? `Mois non réglés : ${months.join(", ")}` : "Mois non réglés : aucun mois indiqué sur les factures", MARGIN + CONTENT_W - 3, y + 13.2, { size: 8.5, bold: true, color: months.length > 0 ? RED : GREY, align: "right" });
  return y + 17;
}

/** Pages de présentation du rapport : couverture, vue d'ensemble, succursales, factures les plus anciennes, puis annexe détaillée. */
function plan(pen: Pen, report: ImpayesReport, assets: ReportAssets): PageSpec[] {
  const pages: PageSpec[] = [];
  const doc = pen.doc;

  pages.push({
    title: "",
    retenir: "",
    draw: () => {
      if (assets.logo) doc.addImage(assets.logo, "PNG", 14, 30, 78, 78 / LOGO_RATIO);
      pen.line(104, 34, 104, 150, { color: ORANGE, width: 1.4 });
      pen.text("Factures impayées", 114, 62, { size: 34, bold: true, color: VIOLET });
      pen.text(`Situation ${report.company} au ${formatDate(report.asOf)}`, 114, 76, { size: 15, bold: true });
      pen.text(`À l'attention de la Direction de la ${report.company}`, 114, 86, { size: 12 });
      if (assets.company) doc.addImage(assets.company, "PNG", 114, 94, 44, 18, undefined, "FAST");
      pen.box(114, 122, 112, 34, { fill: TINT });
      pen.doc.setFillColor(...ORANGE);
      pen.doc.rect(114, 122, 2.4, 34, "F");
      pen.text("Montant total à régler", 121, 130, { size: 10, bold: true, color: VIOLET });
      pen.text(formatDA(report.total), 121, 143, { size: 22, bold: true });
      pen.text(`${report.count} facture(s) en attente`, 121, 151, { size: 10 });
      pen.paragraph(report.headline, 114, 168, 170, { size: 10.5, lineHeight: 4.8, maxLines: 3 });
    },
  });

  pages.push({
    title: "Vue d'ensemble",
    retenir: report.headline,
    draw: () => {
      const gap = 5;
      const w = (CONTENT_W - 3 * gap) / 4;
      const y = 50;
      kpi(pen, MARGIN, y, w, "Montant à régler", millions(report.total), formatDA(report.total), VIOLET);
      kpi(pen, MARGIN + (w + gap), y, w, "Factures en attente", String(report.count), `${report.branches.length} succursale(s)`, VIOLET);
      kpi(pen, MARGIN + 2 * (w + gap), y, w, "Ancienneté moyenne", report.weightedAgeDays === null ? "-" : `${report.weightedAgeDays} jours`, "pondérée par les montants", ORANGE);
      kpi(pen, MARGIN + 3 * (w + gap), y, w, "Plus de 90 jours", pct(report.over90.share), `${millions(report.over90.amount)} · ${report.over90.count} facture(s)`, ORANGE);
      // Répartition par succursale (donut + légende).
      pen.text("Répartition par succursale", MARGIN, 94, { size: 12, bold: true, color: VIOLET });
      const shown = report.branches.slice(0, 7);
      const rest = report.branches.slice(7);
      const slices = [...shown.map((branch) => ({ label: branch.label, amount: branch.amount, share: branch.share })), ...(rest.length > 0 ? [{ label: `Autres (${rest.length})`, amount: rest.reduce((s, b) => s + b.amount, 0), share: Math.round(rest.reduce((s, b) => s + b.share, 0) * 10) / 10 }] : [])];
      donut(pen, MARGIN + 30, 138, 29, 15, slices.map((slice) => slice.amount));
      pen.text(String(report.count), MARGIN + 30, 137, { size: 15, bold: true, align: "center" });
      pen.text("factures", MARGIN + 30, 143, { size: 8.5, align: "center" });
      slices.forEach((slice, index) => {
        const ly = 103 + index * 10;
        pen.doc.setFillColor(...(SLICES[index % SLICES.length] ?? BLACK));
        pen.doc.rect(MARGIN + 66, ly - 3.2, 4.5, 4.5, "F");
        pen.text(slice.label, MARGIN + 73, ly - 0.6, { size: 9.5, bold: true });
        pen.text(`${millions(slice.amount)}  ·  ${pct(slice.share)}`, MARGIN + 73, ly + 3.6, { size: 8.5, color: GREY });
      });
      // Ancienneté.
      pen.text("Ancienneté des factures", 160, 94, { size: 12, bold: true, color: VIOLET });
      agingBars(pen, 160, 100, PAGE_W - MARGIN - 160, report);
    },
  });

  pages.push({
    title: "Situation par succursale",
    retenir: report.branches.length > 0 ? `${report.branches[0]?.label} représente à elle seule ${pct(report.branches[0]?.share ?? 0)} du montant à régler. Les succursales sont classées de la plus élevée à la plus faible.` : "Aucune succursale à afficher.",
    draw: () => {
      const cols: Col[] = [{ w: 62 }, { w: 24, align: "right" }, { w: 46, align: "right" }, { w: 22, align: "right" }, { w: 36 }, { w: 24, align: "right" }, { w: 55, align: "right" }];
      const end = table(
        pen,
        MARGIN,
        52,
        cols,
        ["Succursale", "Factures", "Montant à régler", "Part", "Plus ancienne", "Âge max", "Dont plus de 90 jours"],
        report.branches.map((branch) => [branch.label, String(branch.count), formatDA(branch.amount), pct(branch.share), branch.oldestDate ? formatDate(branch.oldestDate) : "-", branch.oldestDays === null ? "-" : `${branch.oldestDays} j`, branch.over90 > 0 ? `${formatDA(branch.over90)} (${branch.over90Count})` : "-"]),
        { size: 9.5, bold: [true, false, true], footRow: ["TOTAL", String(report.count), formatDA(report.total), "100,0 %", "", "", `${formatDA(report.over90.amount)} (${report.over90.count})`] },
      );
      // Poids de chaque succursale : violet = moins de 90 jours, orange = plus de 90 jours.
      const room = Math.floor((182 - (end + 16)) / 8.5);
      if (room >= 2 && report.branches.length > 0) {
        const top = end + 10;
        pen.text("Poids de chaque succursale", MARGIN, top, { size: 11, bold: true, color: VIOLET });
        pen.doc.setFillColor(...VIOLET);
        pen.doc.rect(PAGE_W - MARGIN - 112, top - 3.4, 4, 4, "F");
        pen.text("moins de 90 jours", PAGE_W - MARGIN - 106, top, { size: 8.5 });
        pen.doc.setFillColor(...ORANGE);
        pen.doc.rect(PAGE_W - MARGIN - 62, top - 3.4, 4, 4, "F");
        pen.text("plus de 90 jours", PAGE_W - MARGIN - 56, top, { size: 8.5 });
        const maxAmount = Math.max(1, ...report.branches.map((branch) => branch.amount));
        const barX = MARGIN + 46;
        const barW = CONTENT_W - 46 - 40;
        report.branches.slice(0, room).forEach((branch, index) => {
          const by = top + 4 + index * 8.5;
          pen.text(branch.label, MARGIN, by + 5, { size: 9, bold: true, maxWidth: 44 });
          const full = (branch.amount / maxAmount) * barW;
          const old90 = branch.amount > 0 ? (branch.over90 / branch.amount) * full : 0;
          pen.doc.setFillColor(...VIOLET);
          if (full - old90 > 0.4) pen.doc.rect(barX, by + 1, full - old90, 5.5, "F");
          pen.doc.setFillColor(...ORANGE);
          if (old90 > 0.4) pen.doc.rect(barX + full - old90, by + 1, old90, 5.5, "F");
          pen.text(millions(branch.amount), barX + full + 2, by + 5, { size: 9, bold: true });
        });
      }
    },
  });

  if (report.oldest.length > 0) {
    pages.push({
      title: "Factures les plus anciennes",
      retenir: `Les ${report.oldest.length} factures les plus anciennes dépassent ${Math.max(0, report.oldest[report.oldest.length - 1]?.ageDays ?? 0)} jours. Leur règlement est la priorité.`,
      draw: () => {
        const cols: Col[] = [{ w: 44 }, { w: 48 }, { w: 24 }, { w: 30 }, { w: 24, align: "right" }, { w: 52, align: "right" }, { w: 47 }];
        table(
          pen,
          MARGIN,
          52,
          cols,
          ["N° de facture", "Succursale", "Période", "Date", "Âge", "Montant", "Dernière relance"],
          report.oldest.map((invoice) => [invoice.numero || "-", invoice.branch, invoice.periode || "-", invoice.date ? formatDate(invoice.date) : "-", invoice.ageDays === null ? "-" : `${invoice.ageDays} j`, formatDA(invoice.amount), invoice.lastReminder ? formatDate(invoice.lastReminder) : "Aucune connue"]),
          { size: 9.5, bold: [true, false, false, false, false, true] },
        );
      },
    });
  }

  // Annexe : une série de pages par succursale.
  const annex = (branch: ReportBranch): void => {
    const chunks: ReportInvoice[][] = [];
    for (let i = 0; i < branch.invoices.length; i += ROWS_PER_PAGE) chunks.push(branch.invoices.slice(i, i + ROWS_PER_PAGE));
    if (chunks.length === 0) chunks.push([]);
    chunks.forEach((chunk, index) => {
      const last = index === chunks.length - 1;
      pages.push({
        title: `Annexe : ${branch.label}${chunks.length > 1 ? ` (${index + 1}/${chunks.length})` : ""}`,
        retenir: branchHeadline(branch),
        draw: () => {
          const top = branchHeader(pen, branch, 50) + 3;
          table(pen, MARGIN, top, invoiceCols, invoiceHead, invoiceRows(chunk), {
            size: 8.5,
            bold: [true, true, false, false, false, false, true],
            cellColor: (row, col) => (col === 1 && monthName(chunk[row]?.periode ?? "") !== "" ? RED : undefined),
            ...(last ? { footRow: [`Sous-total : ${branch.count} facture(s)`, "", "", "", "", "", formatDA(branch.amount)] } : {}),
          });
        },
      });
    });
  };
  report.branches.forEach(annex);
  return pages;
}

/** Dessine le rapport « factures impayées » (A4 paysage, une rubrique par page) sur un document jsPDF vide. */
export function drawImpayesReport(doc: jsPDF, report: ImpayesReport, assets: ReportAssets, generatedAt: string): number {
  const pen = new Pen(doc);
  const pages = plan(pen, report, assets);
  const stamp = `Généré le ${formatDateTime(generatedAt)} (heure d'Alger)`;
  pages.forEach((page, index) => {
    if (index > 0) doc.addPage();
    if (index > 0) {
      if (assets.logo) doc.addImage(assets.logo, "PNG", MARGIN - 3, 4, 22 * LOGO_RATIO, 22);
      pen.text(page.title, MARGIN + 40, 17, { size: 20, bold: true, color: VIOLET });
      pen.line(MARGIN, 27, PAGE_W - MARGIN, 27, { color: ORANGE, width: 0.9 });
      pen.text(report.company, PAGE_W - MARGIN, 12, { size: 12, bold: true, align: "right" });
      pen.box(MARGIN, 31, CONTENT_W, 14, { fill: TINT });
      pen.doc.setFillColor(...ORANGE);
      pen.doc.rect(MARGIN, 31, 2.2, 14, "F");
      pen.text("Ce qu'il faut retenir", MARGIN + 6, 36, { size: 8.5, bold: true, color: VIOLET });
      pen.paragraph(page.retenir, MARGIN + 6, 40.5, CONTENT_W - 10, { size: 10.5, bold: true, maxLines: 2, lineHeight: 4.6 });
    }
    pen.line(MARGIN, 189, PAGE_W - MARGIN, 189, { width: 0.3 });
    pen.text(stamp, MARGIN, 193, { size: 8 });
    pen.text("Allo Assistance", PAGE_W / 2, 193, { size: 8, bold: true, align: "center" });
    pen.text(`Page ${index + 1} / ${pages.length}`, PAGE_W - MARGIN, 193, { size: 8, align: "right" });
    if (assets.footer) {
      const width = 105;
      doc.addImage(assets.footer, "PNG", (PAGE_W - width) / 2, PAGE_H - 3 - width / FOOTER_RATIO, width, width / FOOTER_RATIO);
    }
    page.draw();
  });
  return pages.length;
}
