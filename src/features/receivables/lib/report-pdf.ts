import type { jsPDF } from "jspdf";
import { GREY, ORANGE, Pen, TINT, VIOLET, table, type Col, type Rgb } from "@/features/treasury/lib/deck-pdf";
import { NOT_MONTHLY } from "@/features/partners/lib/production-period";
import { upperPlain } from "@/utils/text";
import type { AdvanceTable } from "@/features/partners/services/advance-table";
import { monthName } from "@/features/receivables/lib/report-mail";
import { directionNature, millions, type ImpayesReport, type ProductionStatus, type ReportInvoice } from "@/features/receivables/lib/report";
import { formatDA, formatDate, formatDateTime } from "@/utils/format";

/** Images de la charte et logo de la compagnie (octets PNG), absents en test. */
export interface ReportAssets {
  logo: Uint8Array | null;
  footer: Uint8Array | null;
  company: Uint8Array | null;
}

/** Données complémentaires facultatives : tableau de paiement mois par mois et réception de la production M-1. */
export interface ReportExtras {
  grid?: AdvanceTable | null;
  production?: ProductionStatus | null;
}

/** Le rapport tient en 3 pages au plus. */
export const REPORT_MAX_PAGES = 3;

const PAGE_W = 297;
const PAGE_H = 210;
const MARGIN = 14;
const CONTENT_W = PAGE_W - 2 * MARGIN;
const LOGO_RATIO = 693 / 384;
const FOOTER_RATIO = 619 / 61;
/** Factures listées au plus sur la page de détail. */
const MAX_DETAIL_ROWS = 17;
/** Rouge des mois non réglés (doublé du gras et d'un libellé pour rester lisible en noir et blanc). */
const RED: Rgb = [200, 20, 20];
const MONTH_SHORT = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

const pct = (value: number): string => `${value.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
/** Montant compact pour les cases du tableau : « 7,97 M » (million de DA), « 654 k » (millier de DA). */
const compact = (value: number): string => (value >= 1_000_000 ? `${(Math.round(value / 10_000) / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} M` : value >= 1000 ? `${Math.round(value / 1000).toLocaleString("fr-FR")} k` : String(Math.round(value)));
const cut = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

interface PageSpec {
  title: string;
  retenir: string;
  draw: () => void;
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

/** Barres d'ancienneté compactes : libellé et montant au-dessus, barre dessous. */
function agingBars(pen: Pen, x: number, y: number, w: number, report: ImpayesReport): void {
  const max = Math.max(1, ...report.aging.map((item) => item.amount));
  report.aging.forEach((item, index) => {
    const top = y + index * 15;
    pen.text(item.label, x, top + 4, { size: 9.5, bold: true });
    pen.text(`${millions(item.amount)} · ${item.count} facture(s) · ${pct(item.share)}`, x + w, top + 4, { size: 8.5, bold: true, align: "right" });
    pen.box(x, top + 6.5, w, 4, { fill: [235, 235, 235] });
    const filled = (item.amount / max) * w;
    if (filled > 0.5) {
      pen.doc.setFillColor(...(item.key === "D90_PLUS" ? ORANGE : item.key === "SANS_DATE" ? ([130, 130, 130] as Rgb) : VIOLET));
      pen.doc.rect(x, top + 6.5, Math.max(filled, 1.2), 4, "F");
    }
  });
}

/** Le reste dû d'une facture du tableau de paiement. */
const dueOf = (invoice: { montant: number; paid: number }): number => Math.max(0, invoice.montant - invoice.paid);

/** Page 1 : chiffres clés, situation par succursale et ancienneté. */
function summaryPage(pen: Pen, report: ImpayesReport): void {
  const gap = 5;
  const w = (CONTENT_W - 3 * gap) / 4;
  kpi(pen, MARGIN, 50, w, "Montant à régler", millions(report.total), formatDA(report.total), VIOLET);
  kpi(pen, MARGIN + (w + gap), 50, w, "Factures en attente", String(report.count), `${report.branches.length} succursale(s) ou service(s)`, VIOLET);
  kpi(pen, MARGIN + 2 * (w + gap), 50, w, "Ancienneté moyenne", report.weightedAgeDays === null ? "-" : `${report.weightedAgeDays} jours`, "pondérée par les montants", ORANGE);
  kpi(pen, MARGIN + 3 * (w + gap), 50, w, "Plus de 90 jours", pct(report.over90.share), `${millions(report.over90.amount)} · ${report.over90.count} facture(s)`, ORANGE);
  pen.text("Situation par succursale", MARGIN, 93, { size: 12, bold: true, color: VIOLET });
  const cols: Col[] = [{ w: 50 }, { w: 20, align: "right" }, { w: 42, align: "right" }, { w: 20, align: "right" }, { w: 25, align: "right" }, { w: 26, align: "right" }];
  table(
    pen,
    MARGIN,
    97,
    cols,
    ["Succursale", "Factures", "Montant à régler", "Part", "Âge max", "+ de 90 jours"],
    report.branches.slice(0, 9).map((branch) => [branch.label, String(branch.count), formatDA(branch.amount), pct(branch.share), branch.oldestDays === null ? "-" : `${branch.oldestDays} j`, branch.over90 > 0 ? millions(branch.over90) : "-"]),
    { size: 8.5, bold: [true, false, true], footRow: ["TOTAL", String(report.count), formatDA(report.total), "100,0 %", "", millions(report.over90.amount)] },
  );
  pen.text("Ancienneté des factures", 206, 93, { size: 12, bold: true, color: VIOLET });
  agingBars(pen, 206, 98, PAGE_W - MARGIN - 206, report);
}

/** Texte de la case d'un mois : reste à encaisser en compact, « réglé » ou « - ». */
function monthCell(cell: AdvanceTable["rows"][number]["months"][number]): string {
  if (cell.state === "vide" || cell.state === "zero") return "-";
  return cell.state === "regle" ? "réglé" : compact(cell.due);
}

/** Page 2 : le tableau de paiement du CRM (succursale × mois) dans un seul tableau, avec les factures hors mois de la direction et la production M-1. */
function gridPage(pen: Pen, grid: AdvanceTable, production: ProductionStatus | null): void {
  const rows = grid.rows;
  const prodHead = production ? `Production ${MONTH_SHORT[Number(production.month.slice(5, 7)) - 1] ?? ""} ${production.month.slice(0, 4)}` : "Production";
  const cols: Col[] = [{ w: 36 }, ...Array.from({ length: 12 }, () => ({ w: 12.4, align: "right" as const })), { w: 27, align: "right" }, { w: 27, align: "right" }, { w: 29, align: "right" }];
  const labelOf = (row: AdvanceTable["rows"][number]): string => (row.key === "AUTRES" ? "Direction générale" : row.label);
  const prodOf = (row: AdvanceTable["rows"][number]): { text: string; missing: boolean } => {
    if (!production || row.key === "AUTRES") return { text: "-", missing: false };
    const state = production.byBranch[row.key];
    if (!state) return { text: "-", missing: false };
    return state.received ? { text: "reçue", missing: false } : { text: "NON REÇUE", missing: true };
  };
  const body = rows.map((row) => [labelOf(row), ...row.months.map(monthCell), row.other.due > 0.005 ? compact(row.other.due) : "-", row.due > 0.005 ? compact(row.due) : "0", prodOf(row).text]);
  const missing = rows.filter((row) => prodOf(row).missing);
  const colorOf = (r: number, c: number): Rgb | undefined => {
    const row = rows[r];
    if (!row) return undefined;
    if (c >= 1 && c <= 12) {
      const cell = row.months[c - 1];
      return cell && (cell.state === "attente" || cell.state === "partiel") ? RED : undefined;
    }
    if (c === 13) return row.other.due > 0.005 ? RED : undefined;
    if (c === 14) return row.due > 0.005 ? RED : undefined;
    return c === 15 && prodOf(row).missing ? RED : undefined;
  };
  let end = table(pen, MARGIN, 50, cols, ["Succursale", ...MONTH_SHORT, "Hors mois (direction)", "Total à régler", prodHead], body, {
    size: 7.5,
    bold: Array.from({ length: 16 }, () => true),
    cellColor: colorOf,
    footRow: ["Total", ...grid.totals.months.map((m) => (m.due > 0.005 ? compact(m.due) : "-")), grid.totals.other.due > 0.005 ? compact(grid.totals.other.due) : "-", compact(grid.totals.due), missing.length > 0 ? `${missing.length} manquante(s)` : production ? "complète" : ""],
  });
  pen.text("Rouge et gras : reste à encaisser (mois non réglé). « réglé » : mois soldé. « - » : aucune facture. k = millier de DA, M = million de DA.", MARGIN, end + 5, { size: 8, bold: true });
  end += 11;

  // Factures de la direction générale, hors mois.
  const direction = rows.flatMap((row) => row.other.invoices.map((invoice) => ({ row, invoice }))).filter(({ invoice }) => dueOf(invoice) > 0.005 && directionNature(invoice.libelle) !== null);
  if (direction.length > 0) {
    pen.text("Factures de la direction générale (hors mois)", MARGIN, end + 2, { size: 11, bold: true, color: VIOLET });
    const shown = direction.slice(0, 4);
    end = table(
      pen,
      MARGIN,
      end + 5,
      [{ w: 40 }, { w: 62 }, { w: 95 }, { w: 30 }, { w: 42, align: "right" }],
      ["N° de facture", "Nature", "Libellé", "Date", "Reste à régler"],
      shown.map(({ invoice }) => [invoice.numero || "sans n°", directionNature(invoice.libelle) ?? "", cut(invoice.libelle, 62), invoice.dateFacture ? formatDate(invoice.dateFacture) : "Sans date", formatDA(dueOf(invoice))]),
      { size: 8, bold: [true, true, false, false, true], cellColor: (_r, c) => (c === 4 ? RED : undefined) },
    );
    if (direction.length > shown.length) pen.text(`et ${direction.length - shown.length} autre(s) facture(s) de la direction, voir le détail.`, MARGIN, end + 4.5, { size: 8, bold: true });
    end += 8;
  }

  // Production non reçue.
  if (production) {
    const label = monthName(production.month);
    if (missing.length === 0) {
      pen.text(`Production de ${label} : reçue de toutes les succursales.`, MARGIN, end + 4, { size: 9.5, bold: true });
    } else {
      pen.text(`Production de ${label} non reçue`, MARGIN, end + 4, { size: 11, bold: true, color: RED });
      missing.slice(0, 5).forEach((row, index) => {
        const last = production.byBranch[row.key]?.last ?? null;
        pen.text(`${row.label} : aucune production de ${label} à ce jour${last ? ` (dernière reçue : ${monthName(last)})` : " (aucune production reçue)"}.`, MARGIN + 3, end + 10 + index * 5, { size: 9.5, bold: true });
      });
    }
  }
}

/** Mois de la facture : en rouge si le mois n'est pas réglé, « Hors mois » pour une facture de la direction. */
function monthLabel(invoice: ReportInvoice): string {
  const nature = directionNature(invoice.libelle);
  if (nature) return `Hors mois : ${nature.toLowerCase().split(",")[0]}`;
  const name = monthName(invoice.periode);
  if (name) return `${name} (impayé)`;
  return NOT_MONTHLY.test(upperPlain(invoice.libelle)) ? "Hors mois : régularisation" : "Mois non indiqué";
}

/** Page 3 : toutes les factures impayées dans un seul tableau (les plus anciennes si la liste dépasse la page). */
function detailPage(pen: Pen, report: ImpayesReport): void {
  const all = report.branches.flatMap((branch) => branch.invoices);
  const kept = all.length > MAX_DETAIL_ROWS ? [...all].sort((a, b) => (b.ageDays ?? -1) - (a.ageDays ?? -1) || b.amount - a.amount).slice(0, MAX_DETAIL_ROWS) : all;
  const order = new Map(report.branches.map((branch, index) => [branch.label, index]));
  const shown = [...kept].sort((a, b) => (order.get(a.branch) ?? 0) - (order.get(b.branch) ?? 0) || (b.ageDays ?? -1) - (a.ageDays ?? -1));
  const cols: Col[] = [{ w: 38 }, { w: 36 }, { w: 44 }, { w: 68 }, { w: 24 }, { w: 18, align: "right" }, { w: 41, align: "right" }];
  const end = table(
    pen,
    MARGIN,
    50,
    cols,
    ["Succursale", "N° de facture", "Mois impayé", "Libellé", "Date", "Âge", "Montant"],
    shown.map((invoice) => [invoice.branch, invoice.numero || "sans n°", monthLabel(invoice), cut(invoice.libelle || "-", 44), invoice.date ? formatDate(invoice.date) : "Sans date", invoice.ageDays === null ? "-" : `${invoice.ageDays} j`, formatDA(invoice.amount)]),
    {
      size: 7.5,
      bold: [true, true, true, false, false, false, true],
      cellColor: (row, col) => (col === 2 && monthName(shown[row]?.periode ?? "") !== "" && directionNature(shown[row]?.libelle ?? "") === null ? RED : undefined),
      footRow: [`Total : ${report.count} facture(s)`, "", "", "", "", "", formatDA(report.total)],
    },
  );
  if (all.length > shown.length) pen.text(`Liste limitée aux ${shown.length} factures les plus anciennes sur ${all.length}. Le détail complet est dans l'export Excel des créances.`, MARGIN, end + 5, { size: 8.5, bold: true });
}

/** Pages du rapport : synthèse, tableau de paiement (si disponible), détail des factures. */
function plan(pen: Pen, report: ImpayesReport, extras: ReportExtras): PageSpec[] {
  const pages: PageSpec[] = [
    {
      title: `Impayés ${report.company} au ${formatDate(report.asOf)}`,
      retenir: report.headline,
      draw: () => summaryPage(pen, report),
    },
  ];
  const grid = extras.grid;
  if (grid && grid.rows.length > 0) {
    const production = extras.production ?? null;
    const missing = production ? grid.rows.filter((row) => row.key !== "AUTRES" && production.byBranch[row.key] && !production.byBranch[row.key]?.received).map((row) => row.label) : [];
    const direction = grid.rows.find((row) => row.key === "AUTRES")?.other.due ?? 0;
    pages.push({
      title: `Tableau de paiement ${grid.client} ${grid.year}`,
      retenir:
        `Reste à encaisser : ${formatDA(grid.totals.due)}${direction > 0.005 ? `, dont ${formatDA(direction)} de factures de la direction générale hors mois` : ""}.` +
        (production ? (missing.length > 0 ? ` Production de ${monthName(production.month)} non reçue : ${missing.join(", ")}.` : ` Production de ${monthName(production.month)} reçue de toutes les succursales.`) : ""),
      draw: () => gridPage(pen, grid, production),
    });
  }
  pages.push({
    title: "Détail des factures impayées",
    retenir: `${report.count} facture(s) pour ${formatDA(report.total)}. Les mois non réglés sont en rouge ; les factures de la direction générale sont indiquées « hors mois ».`,
    draw: () => detailPage(pen, report),
  });
  return pages;
}

/** Dessine le rapport « factures impayées » (A4 paysage, 3 pages au plus) sur un document jsPDF vide ; renvoie le nombre de pages. */
export function drawImpayesReport(doc: jsPDF, report: ImpayesReport, assets: ReportAssets, generatedAt: string, extras: ReportExtras = {}): number {
  const pen = new Pen(doc);
  const pages = plan(pen, report, extras);
  const stamp = `Généré le ${formatDateTime(generatedAt)} (heure d'Alger)`;
  pages.forEach((page, index) => {
    if (index > 0) doc.addPage();
    if (assets.logo) doc.addImage(assets.logo, "PNG", MARGIN - 3, 4, 22 * LOGO_RATIO, 22);
    pen.text(page.title, MARGIN + 40, 17, { size: 20, bold: true, color: VIOLET });
    pen.line(MARGIN, 27, PAGE_W - MARGIN, 27, { color: ORANGE, width: 0.9 });
    pen.text(report.company, PAGE_W - MARGIN, 12, { size: 12, bold: true, align: "right" });
    pen.box(MARGIN, 31, CONTENT_W, 14, { fill: TINT });
    pen.doc.setFillColor(...ORANGE);
    pen.doc.rect(MARGIN, 31, 2.2, 14, "F");
    pen.text("Ce qu'il faut retenir", MARGIN + 6, 36, { size: 8.5, bold: true, color: VIOLET });
    pen.paragraph(page.retenir, MARGIN + 6, 40.5, CONTENT_W - 10, { size: 10, bold: true, maxLines: 2, lineHeight: 4.4 });
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
