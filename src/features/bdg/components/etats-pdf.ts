import type { EtatsAgences } from "@/features/bdg/services/etats-agences";

/** Réglages du PDF : papier en-tête (logo et pied de page). */
export interface EtatsPdfOptions {
  logo: boolean;
}

const LOGO_RATIO = 224 / 121;
const FOOTER_RATIO = 619 / 61;
const PAGE_W = 297;
const PAGE_H = 210;
const MARGIN = 12;

/** Le PDF standard n'accepte que le latin-1 : on remplace espaces fines et caractères hors jeu. */
const latin = (value: unknown): string =>
  String(value ?? "")
    .replace(/[\u00a0\u202f]/g, " ")
    .replace(/[^\x00-\xFF]/g, "?");

const money = (value: number): string => latin(value.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

async function imageData(url: string): Promise<string> {
  const response = await fetch(url);
  const blob = await response.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Image illisible."));
    reader.readAsDataURL(blob);
  });
}

/**
 * Fabrique le PDF A4 paysage des états : un état (récapitulatif -1, ou agence n) ou tous.
 * Logo en haut à gauche, titre centré, tableau, encadré des totaux et pied de page Allo Assistance.
 */
export async function buildEtatsPdf(etats: EtatsAgences, which: number | "all", options: EtatsPdfOptions): Promise<Blob> {
  const [{ jsPDF }, tableModule] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  // Selon l'outil de compilation, la fonction est exposée en export par défaut ou un niveau plus bas.
  const exported: unknown = tableModule.default;
  const autoTable = (typeof exported === "function" ? exported : (exported as { default: unknown }).default) as typeof tableModule.default;
  const [logo, footer] = options.logo ? await Promise.all([imageData("/etats/logo.png"), imageData("/etats/pied.png")]) : ["", ""];
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pc = `${Number(etats.tauxTva.toFixed(2))} %`;
  const bottom = options.logo ? 30 : 14;
  const last = (): number => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

  const drawFooter = (): void => {
    if (!options.logo) return;
    const width = 150;
    doc.addImage(footer, "PNG", (PAGE_W - width) / 2, PAGE_H - 8 - width / FOOTER_RATIO, width, width / FOOTER_RATIO);
  };

  const page = (k: number, first: boolean): void => {
    if (!first) doc.addPage();
    let y0 = 14;
    if (options.logo) {
      doc.addImage(logo, "PNG", MARGIN, 8, 22 * LOGO_RATIO, 22);
      y0 = 34;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.setTextColor(0, 0, 0);
    doc.text(latin(k < 0 ? etats.titreGeneral : etats.titre), PAGE_W / 2, y0 + 4, { align: "center" });
    const styles = { font: "helvetica", fontSize: 9, halign: "center" as const, valign: "middle" as const, lineColor: [0, 0, 0] as [number, number, number], lineWidth: 0.2, textColor: [0, 0, 0] as [number, number, number], cellPadding: 2 };
    const base = { theme: "grid" as const, margin: { left: MARGIN, right: MARGIN, bottom }, styles, headStyles: { fillColor: [217, 225, 242] as [number, number, number], textColor: [0, 0, 0] as [number, number, number], fontStyle: "bold" as const }, didDrawPage: drawFooter };
    let totals: [number, number, number];
    if (k < 0) {
      const sum = (field: "ht" | "tva" | "ttc"): number => etats.agencies.reduce((s, a) => s + a[field], 0);
      autoTable(doc, {
        ...base,
        startY: y0 + 10,
        head: [["N°", "Agence", "Nombre de factures", "TOTAL HT", `TVA ${pc}`, "TOTAL TTC"]],
        body: etats.agencies.map((a, i) => [i + 1, latin(a.name), a.rows.length, money(a.ht), money(a.tva), money(a.ttc)]),
        foot: [["", "TOTAL GÉNÉRAL", etats.totals.n, money(sum("ht")), money(sum("tva")), money(sum("ttc"))]],
        showFoot: "lastPage",
        footStyles: { fillColor: [255, 217, 102], textColor: [0, 0, 0], fontStyle: "bold" },
        columnStyles: { 1: { halign: "left" }, 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" } },
      });
      totals = [sum("ht"), sum("tva"), sum("ttc")];
    } else {
      const agency = etats.agencies[k];
      if (!agency) return;
      autoTable(doc, {
        ...base,
        startY: y0 + 10,
        head: [etats.columns.map(latin)],
        body: agency.rows.map((row) => row.cells.map((cell, j) => (j === etats.htIndex ? (row.amount !== null ? money(row.amount) : latin(row.raw)) : latin(cell)))),
        columnStyles: { [etats.htIndex]: { halign: "right" } },
      });
      totals = [agency.ht, agency.tva, agency.ttc];
    }
    let sy = last() + 8;
    if (sy + 30 > PAGE_H - bottom) {
      doc.addPage();
      sy = 14;
      drawFooter();
    }
    autoTable(doc, {
      startY: sy,
      theme: "grid",
      margin: { left: PAGE_W - MARGIN - 95, right: MARGIN, bottom },
      tableWidth: 95,
      body: [["TOTAL HT", money(totals[0])], [`TVA ${pc}`, money(totals[1])], ["TOTAL TTC", money(totals[2])]],
      styles: { ...styles, fontSize: 11, fontStyle: "bold", cellPadding: 3 },
      columnStyles: { 0: { halign: "center", cellWidth: 40 }, 1: { halign: "right" } },
      didParseCell: (data) => {
        if (data.row.index === 2) data.cell.styles.fillColor = [255, 242, 204];
      },
      didDrawCell: (data) => {
        if (data.row.index === 2) {
          doc.setLineWidth(0.7);
          doc.rect(data.cell.x, data.cell.y, data.cell.width, data.cell.height);
        }
      },
      didDrawPage: drawFooter,
    });
  };

  if (which === "all") {
    page(-1, true);
    etats.agencies.forEach((_, i) => page(i, false));
  } else {
    page(which, true);
  }
  return doc.output("blob");
}
