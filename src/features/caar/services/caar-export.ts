import { db } from "@/lib/db";
import { writeWorkbook, type SheetToWrite } from "@/lib/spreadsheet";
import { requireAccess } from "@/features/access/services/access-rules";
import type { AuthUser } from "@/features/access/types";
import { getProduction } from "@/features/caar/services/caar-service";
import type { ExportedFile } from "@/features/invoices/services/invoice-export";
import { logAction } from "@/features/journal/services/journal-service";
import { ok, type ActionResult } from "@/types";

const money = (value: number): number => Math.round(value * 100) / 100;

/**
 * Excel du contrôle d'une production CAAR, tel qu'affiché à l'écran (synthèse, TCD, formules,
 * points relevés, lignes à corriger) plus le détail ligne à ligne du fichier contrôlé.
 * Lecture seule : aucun calcul n'est refait, les valeurs enregistrées sont reprises.
 */
export async function exportProduction(actor: AuthUser, id: string): Promise<ActionResult<ExportedFile>> {
  const guard = requireAccess(actor, "CAAR");
  if (!guard.success) return guard;
  const detail = await getProduction(actor, id);
  if (!detail.success) return detail;
  const p = detail.data;
  const chunks = await db.caarProductionChunk.findMany({ where: { productionId: id }, orderBy: { k: "asc" } });

  const synth: SheetToWrite["rows"] = [
    [`CAAR ${p.succursale} — ${p.periodLabel}`],
    [`Fichier : ${p.fichier}`, `${p.totals.n} polices retenues`],
    [],
    ["Prime nette", money(p.totals.prime)],
    ["Part ALLO 47 %", money(p.totals.allo)],
    ["Avance 90 % HT", money(p.totals.av)],
    ["TVA 19 %", money(p.totals.tva)],
    ["TTC à facturer", money(p.totals.ttc)],
    [],
    ["Facture", p.invoice ? `N° ${p.invoice.num} du ${p.invoice.date} — ${money(p.invoice.ttc)} DA` : "À facturer"],
    [],
    ...p.checks.map((check) => {
      const gap = money(check.ours - check.declared);
      return [`${check.label} déclarée`, money(check.declared), check.src, Math.abs(gap) < 1 ? "Identique au total recalculé" : `Écart de ${gap} DA avec le total recalculé`];
    }),
  ];
  const tcd: SheetToWrite["rows"] = [
    ["Agence", "Polices", "Prime nette", "Part ALLO 47 %"],
    ...p.tcd.map(([agence, n, prime]) => [agence, n, money(prime), money((prime * 47) / 100)]),
    ["Total", p.totals.n, money(p.totals.prime), money(p.totals.allo)],
  ];
  const sheets: SheetToWrite[] = [
    { name: "Synthèse", rows: synth, widths: [28, 20, 40, 40] },
    { name: "TCD par agence", rows: tcd, widths: [30, 10, 18, 18] },
  ];
  if (p.products.length) {
    sheets.push({ name: "Formules", rows: [["Formule", "Polices", "Prime", "Hors barème"], ...p.products.map(([, label, n, prime, ko]) => [label, n, money(prime), ko])], widths: [40, 10, 18, 14] });
  }
  sheets.push({ name: "Points relevés", rows: [["Point", "Gravité", "Nombre"], ...p.kinds.map((kind) => [kind.label, kind.severity === "err" ? "Erreur" : kind.severity === "warn" ? "Alerte" : "Info", kind.count])], widths: [50, 10, 10] });
  if (p.anomalyLines.length) {
    sheets.push({
      name: "Lignes à corriger",
      rows: [["Ligne", "Agence", "Police", "Assuré", "Prime", "Motif", "Base"], ...p.anomalyLines.map((l) => [l.line, l.agence, l.police, l.nom, l.prime === null ? null : money(l.prime), l.flags.join(", "), l.basis])],
      widths: [8, 18, 18, 30, 16, 40, 40],
    });
  }
  const detailRows: SheetToWrite["rows"] = [["Ligne", "Agence", "Police", "Assuré", "Immatriculation", "Effet", "Échéance", "Formule", "Produit", "Prime", "Retenue", "Points"]];
  for (const chunk of chunks) {
    if (!Array.isArray(chunk.rows)) continue;
    for (const raw of chunk.rows as unknown[]) {
      if (!Array.isArray(raw)) continue;
      detailRows.push(raw.map((cell) => (typeof cell === "number" || typeof cell === "string" ? cell : cell === null || cell === undefined ? null : String(cell))));
    }
  }
  if (detailRows.length > 1) sheets.push({ name: "Détail des polices", rows: detailRows, widths: [8, 18, 18, 30, 18, 12, 12, 18, 14, 16, 9, 30] });

  await logAction(actor, "Export Excel contrôle CAAR", `${p.succursale} ${p.periodLabel}`);
  const safe = `${p.succursale}_${p.periodLabel}`.replace(/[^A-Za-z0-9À-ÿ]+/g, "_");
  return ok({ name: `Controle_CAAR_${safe}.xlsx`, bytes: writeWorkbook(sheets) });
}
