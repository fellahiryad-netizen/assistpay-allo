import { readFile } from "node:fs/promises";
import path from "node:path";
import type { AuthUser } from "@/features/access/types";
import { can, requireAccess } from "@/features/access/services/access-rules";
import { db } from "@/lib/db";
import { buildImpayesReport, excludeFromGrid, excludeFromReport, productionStatusOf, type ProductionStatus } from "@/features/receivables/lib/report";
import { buildImpayesMail, type ImpayesMail } from "@/features/receivables/lib/report-mail";
import { drawImpayesReport, type ReportAssets } from "@/features/receivables/lib/report-pdf";
import type { ImpayesMailInput, ReceivablesQuery } from "@/features/receivables/schemas";
import { getReceivableDetail } from "@/features/receivables/services/receivables-service";
import { companySlug } from "@/features/receivables/lib/company";
import { advanceTable, type AdvanceTable } from "@/features/partners/services/advance-table";
import { fail, ok, type ActionResult } from "@/types";

async function readAsset(file: string): Promise<Uint8Array | null> {
  try {
    return new Uint8Array(await readFile(path.join(process.cwd(), "public", file)));
  } catch {
    return null;
  }
}

/**
 * Tableau de paiement mois par mois et réception de la production M-1 (CAAR seulement, lecture seule).
 * Si l'un des deux est indisponible, il vaut `null` et le rapport ou le mail sort sans cette partie.
 */
async function loadExtras(actor: AuthUser, company: string, annee: number | undefined, asOf: string): Promise<{ grid: AdvanceTable | null; production: ProductionStatus | null }> {
  if (company !== "CAAR") return { grid: null, production: null };
  const table = await advanceTable(actor, "CAAR", annee ?? Number(asOf.slice(0, 4)));
  const grid = table.success ? excludeFromGrid(table.data) : null;
  if (!grid || !can(actor, "CAAR")) return { grid, production: null };
  const files = await db.caarProduction.findMany({ select: { annee: true, mois: true, succursale: true } });
  return { grid, production: productionStatusOf(files, asOf, grid.rows.filter((row) => row.key !== "AUTRES").map((row) => row.key)) };
}

/**
 * Rapport PDF « factures impayées » (A4 paysage) d'une compagnie, à présenter à sa direction :
 * 3 pages au plus : synthèse, tableau de paiement mois par mois (avec production M-1), détail des factures.
 * Lecture seule. Droits : factures partenaires et bouton d'export. Le périmètre est la compagnie de `query.detail` (toutes activités, sans filtre d'activité ni d'ancienneté).
 */
export async function exportImpayesReport(actor: AuthUser, query: ReceivablesQuery): Promise<ActionResult<{ name: string; bytes: Uint8Array; pages: number }>> {
  const allowed = requireAccess(actor, "A_EXPORT", "EDIT");
  if (!allowed.success) return allowed;
  const scope = query.detail ? query.detail.split(":")[0] : undefined;
  const result = await getReceivableDetail(actor, { ...query, detail: scope, anc: undefined, activite: undefined });
  if (!result.success) return result;
  try {
    const report = buildImpayesReport(excludeFromReport(result.data.detail), result.data.asOf);
    const slug = companySlug(report.company);
    const [logo, footer, company] = await Promise.all([readAsset("logo-allo.png"), readAsset("etats/pied.png"), readAsset(`partenaires/${slug}.png`)]);
    const { jsPDF } = await import("jspdf");
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4", compress: true });
    doc.setProperties({ title: `Factures impayées ${report.company}`, subject: `Situation au ${report.asOf}`, author: "Allo Assistance" });
    const assets: ReportAssets = { logo, footer, company };
    const { grid, production } = await loadExtras(actor, report.company, query.annee, result.data.asOf);
    const pages = drawImpayesReport(doc, report, assets, new Date().toISOString(), { grid, production });
    return ok({ name: `impayes_${slug || "compagnie"}_${report.asOf}.pdf`, bytes: new Uint8Array(doc.output("arraybuffer")), pages });
  } catch (error) {
    console.error("[receivables] rapport PDF impossible :", error);
    return fail("Le rapport PDF n'a pas pu être généré.", "DATABASE");
  }
}

/**
 * Mail préparé pour la directrice d'une compagnie : mois et montants en retard de règlement par succursale, factures de la direction générale et productions non reçues.
 * Lecture seule ; mêmes droits que le rapport PDF. La signature porte le nom de l'utilisateur.
 */
export async function prepareImpayesMail(actor: AuthUser, input: ImpayesMailInput): Promise<ActionResult<ImpayesMail>> {
  const allowed = requireAccess(actor, "A_EXPORT", "EDIT");
  if (!allowed.success) return allowed;
  const result = await getReceivableDetail(actor, { detail: input.company, annee: input.annee, anc: undefined, activite: undefined });
  if (!result.success) return result;
  const report = buildImpayesReport(excludeFromReport(result.data.detail), result.data.asOf);
  const { grid, production } = await loadExtras(actor, report.company, input.annee, result.data.asOf);
  const labels = Object.fromEntries((grid?.rows ?? []).filter((row) => row.key !== "AUTRES").map((row) => [row.key, row.label]));
  return ok(buildImpayesMail(report, input.jours, actor.name, { production, labels }));
}
