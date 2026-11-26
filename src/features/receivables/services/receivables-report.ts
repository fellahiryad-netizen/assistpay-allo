import { readFile } from "node:fs/promises";
import path from "node:path";
import type { AuthUser } from "@/features/access/types";
import { requireAccess } from "@/features/access/services/access-rules";
import { buildImpayesReport } from "@/features/receivables/lib/report";
import { drawImpayesReport, type ReportAssets } from "@/features/receivables/lib/report-pdf";
import type { ReceivablesQuery } from "@/features/receivables/schemas";
import { getReceivableDetail } from "@/features/receivables/services/receivables-service";
import { companySlug } from "@/features/receivables/lib/company";
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
 * couverture, vue d'ensemble, situation par succursale, factures les plus anciennes, annexe détaillée.
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
    const pages = drawImpayesReport(doc, report, assets, new Date().toISOString());
    return ok({ name: `impayes_${slug || "compagnie"}_${report.asOf}.pdf`, bytes: new Uint8Array(doc.output("arraybuffer")), pages });
  } catch (error) {
    console.error("[receivables] rapport PDF impossible :", error);
    return fail("Le rapport PDF n'a pas pu être généré.", "DATABASE");
  }
}
