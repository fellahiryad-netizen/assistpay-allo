import { db } from "@/lib/db";
import { writeWorkbook } from "@/lib/spreadsheet";
import { can, requireAccess } from "@/features/access/services/access-rules";
import type { AuthUser } from "@/features/access/types";
import { logAction } from "@/features/journal/services/journal-service";
import { ok, type ActionResult } from "@/types";
import { todayIso } from "@/utils/dates";

type Flat = Record<string, string | number | null>;

function flatten(row: Record<string, unknown>): Flat {
  const out: Flat = {};
  for (const [key, value] of Object.entries(row)) {
    if (value === null || value === undefined) out[key] = "";
    else if (value instanceof Date) out[key] = value.toISOString().slice(0, value.getUTCHours() || value.getUTCMinutes() ? 19 : 10);
    else if (typeof value === "object" && "toNumber" in (value as object)) out[key] = Number(String(value));
    else if (typeof value === "object") out[key] = JSON.stringify(value).slice(0, 32_000);
    else if (typeof value === "string" || typeof value === "number") out[key] = value;
    else if (typeof value === "boolean") out[key] = value ? "oui" : "non";
    else out[key] = String(value);
  }
  return out;
}

/**
 * Sauvegarde complète (fin de mois) : factures, relevé, demandes de paiement, factures établies, productions CAAR,
 * envois de virements, RIB, journal — et RH si l'utilisateur y a accès. Format Excel lisible ou JSON complet.
 */
export async function buildBackup(actor: AuthUser, format: "xlsx" | "json"): Promise<ActionResult<{ name: string; bytes: Uint8Array; type: string }>> {
  const guard = requireAccess(actor, "PILOT");
  if (!guard.success) return guard;
  const withPayroll = can(actor, "RH");
  const [factures, releve, demandesPaiement, facturesEtablies, caarProduction, virements, rib, rh] = await Promise.all([
    db.invoice.findMany({ where: withPayroll ? {} : { payroll: false }, orderBy: { createdAt: "asc" } }),
    db.bankStatementLine.findMany({ orderBy: { date: "asc" } }),
    db.paymentRequest.findMany({ orderBy: { createdAt: "asc" } }),
    db.issuedInvoice.findMany({ orderBy: { createdAt: "asc" } }),
    db.caarProduction.findMany({ orderBy: [{ annee: "asc" }, { mois: "asc" }] }),
    db.transferBatch.findMany({ orderBy: { updatedAt: "asc" } }),
    db.providerRib.findMany(),
    withPayroll ? db.hrEntry.findMany({ orderBy: { date: "asc" } }) : Promise.resolve([]),
  ]);
  const data: Record<string, unknown[]> = { factures, releve, demandesPaiement, facturesEtablies, caarProduction, virements, rib, ...(withPayroll ? { rh } : {}) };
  const stamp = todayIso();
  await logAction(actor, "Sauvegarde complète téléchargée", `${stamp} (${format.toUpperCase()})`);
  if (format === "json") {
    const json = JSON.stringify({ exporte: new Date().toISOString(), par: actor.name, ...data });
    return ok({ name: `Sauvegarde_AssistPay_${stamp}.json`, bytes: new TextEncoder().encode(json), type: "application/json" });
  }
  const sheets = Object.entries(data)
    .filter(([, rows]) => rows.length)
    .map(([name, rows]) => {
      const flat = rows.map((row) => flatten(row as Record<string, unknown>));
      const headers = Object.keys(flat[0] ?? {});
      return { name: name.slice(0, 31), rows: [headers, ...flat.map((row) => headers.map((header) => row[header] ?? ""))] };
    });
  return ok({ name: `Sauvegarde_AssistPay_${stamp}.xlsx`, bytes: writeWorkbook(sheets), type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
