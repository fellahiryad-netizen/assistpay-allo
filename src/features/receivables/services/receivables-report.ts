import { readFile } from "node:fs/promises";
import path from "node:path";
import type { AuthUser } from "@/features/access/types";
import { requireAccess } from "@/features/access/services/access-rules";
import { db } from "@/lib/db";
import { can } from "@/features/access/services/access-rules";
import { buildImpayesReport, productionStatusOf, type ProductionStatus } from "@/features/receivables/lib/report";
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
    const report = buildImpayesReport(result.data.detail, result.data.asOf);
    const slug = companySlug(report.company);
    const [logo, footer, company] = await Promise.all([readAsset("logo-allo.png"), readAsset("etats/pied.png"), readAsset(`partenaires/${slug}.png`)]);
    const { jsPDF } = await import("jspdf");
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4", compress: true });
    doc.setProperties({ title: `Factures impayées ${report.company}`, subject: `Situation au ${report.asOf}`, author: "Allo Assistance" });
    const assets: ReportAssets = { logo, footer, company };
    // Tableau de paiement mois par mois et réception de la production M-1 (CAAR seulement, lecture seule).
    // Si l'un des deux est indisponible, le rapport sort sans cette partie.
    let grid: AdvanceTable | null = null;
    let production: ProductionStatus | null = null;
    if (report.company === "CAAR") {
      const year = query.annee ?? Number(result.data.asOf.slice(0, 4));
      const table = await advanceTable(actor, "CAAR", year);
      if (table.success) grid = table.data;
      if (grid && can(actor, "CAAR")) {
        const files = await db.caarProduction.findMany({ select: { annee: true, mois: true, succursale: true } });
        production = productionStatusOf(files, result.data.asOf, grid.rows.filter((row) => row.key !== "AUTRES").map((row) => row.key));
      }
    }
    const pages = drawImpayesReport(doc, report, assets, new Date().toISOString(), { grid, production });
    return ok({ name: `impayes_${slug || "compagnie"}_${report.asOf}.pdf`, bytes: new Uint8Array(doc.output("arraybuffer")), pages });
  } catch (error) {
    console.error("[receivables] rapport PDF impossible :", error);
    return fail("Le rapport PDF n'a pas pu être généré.", "DATABASE");
  }
}

/**
 * Mail préparé pour la direction d'une compagnie : succursales en retard (factures émises depuis plus de `jours` jours) et mois en retard de chacune.
 * Lecture seule ; mêmes droits que le rapport PDF. La signature porte le nom de l'utilisateur.
 */
export async function prepareImpayesMail(actor: AuthUser, input: ImpayesMailInput): Promise<ActionResult<ImpayesMail>> {
  const allowed = requireAccess(actor, "A_EXPORT", "EDIT");
  if (!allowed.success) return allowed;
  const result = await getReceivableDetail(actor, { detail: input.company, annee: input.annee, anc: undefined, activite: undefined });
  if (!result.success) return result;
  const report = buildImpayesReport(result.data.detail, result.data.asOf);
  return ok(buildImpayesMail(report, input.jours, actor.name));
}
