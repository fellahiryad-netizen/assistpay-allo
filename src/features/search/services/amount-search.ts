import { db } from "@/lib/db";
import { can } from "@/features/access/services/access-rules";
import type { AuthUser } from "@/features/access/types";
import { decimalToNumber } from "@/features/invoices/services/invoice-mapper";
import { visibilityWhere } from "@/features/invoices/services/invoice-service";
import { fail, ok, type ActionResult } from "@/types";
import { toIsoDate } from "@/utils/dates";

/** Une occurrence du montant recherché, avec l'endroit où elle se trouve. */
export interface AmountHit {
  /** Où : facture, relevé bancaire, demande de paiement ou envoi de virements. */
  where: "Facture" | "Relevé bancaire" | "Demande de paiement" | "Envoi de virements";
  title: string;
  detail: string;
  amount: number;
  date: string | null;
  state: string;
  href: string;
}

const SENS: Record<string, string> = { CREDIT: "Crédit (client)", DEBIT: "Débit (fournisseur)" };
const INVOICE_STATE: Record<string, string> = { EN_ATTENTE: "en attente", REGLE: "réglée", ANNULE: "annulée" };
const LINE_STATE: Record<string, string> = { A_TRAITER: "à traiter", RAPPROCHE: "rapproché", DEJA: "déjà relié", AJOUTE: "ajouté au suivi", IGNORE: "ignoré" };

/** Lit un montant tapé librement (« 5 435 384,50 », « 5435384.5 », « 27500 DA »). Sans décimales, toutes les décimales sont acceptées. */
export function parseAmount(raw: string): { from: number; to: number } | null {
  const cleaned = raw.replace(/[\s  ]/g, "").replace(/da$/i, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value <= 0) return null;
  return cleaned.includes(".") ? { from: value - 0.005, to: value + 0.005 } : { from: value, to: value + 0.99 };
}

/**
 * Cherche un montant partout : factures (montant, débours, frais, montant global), relevé bancaire, demandes de paiement et envois de virements.
 * Chaque source n'est cherchée que si l'utilisateur y a accès.
 */
export async function searchByAmount(actor: AuthUser, raw: string): Promise<ActionResult<AmountHit[]>> {
  const range = parseAmount(raw);
  if (!range) return fail("Tapez un montant, par exemple 5 435 384,50.", "VALIDATION");
  const between = { gte: range.from, lte: range.to };
  try {
    const hits: AmountHit[] = [];
    const visibility = visibilityWhere(actor);
    if (visibility) {
      const rows = await db.invoice.findMany({
        where: { AND: [visibility, { OR: [{ montant: between }, { debours: between }, { frais: between }, { montantGlobal: between }] }] },
        orderBy: { updatedAt: "desc" },
        take: 60,
      });
      for (const row of rows) {
        const part = row.montant.toNumber() >= range.from && row.montant.toNumber() <= range.to ? "" : row.debours && decimalToNumber(row.debours) >= range.from && decimalToNumber(row.debours) <= range.to ? " (débours)" : row.frais && decimalToNumber(row.frais) >= range.from && decimalToNumber(row.frais) <= range.to ? " (frais)" : " (montant global)";
        hits.push({
          where: "Facture",
          title: `${row.tiers || row.categorie}${row.numero ? ` · ${row.numero}` : ""}${part}`,
          detail: `${SENS[row.sens]} · ${row.categorie}${row.succursale ? ` · ${row.succursale}` : ""} · ${row.libelle}`,
          amount: decimalToNumber(row.montant),
          date: toIsoDate(row.dateOperation) ?? toIsoDate(row.dateFacture),
          state: INVOICE_STATE[row.status],
          href: `/factures/${row.id}`,
        });
      }
    }
    if (can(actor, "RELEVE")) {
      const lines = await db.bankStatementLine.findMany({ where: { montant: between }, orderBy: { date: "desc" }, take: 40 });
      for (const line of lines) {
        const linked = line.invoiceRefs.length ? ` · relié à ${line.invoiceRefs.map((ref: string) => ref.split(":")[0]).join(", ")}` : "";
        hits.push({
          where: "Relevé bancaire",
          title: line.libelle,
          detail: `${line.sens === "CREDIT" ? "Encaissement" : "Décaissement"} ${line.type}${line.numero ? ` n° ${line.numero}` : ""}${linked}`,
          amount: decimalToNumber(line.montant),
          date: toIsoDate(line.date),
          state: LINE_STATE[line.status] ?? line.status.toLowerCase(),
          href: `/releve?onglet=historique&q=${encodeURIComponent(raw.trim())}`,
        });
      }
    }
    if (can(actor, "DP")) {
      const requests = await db.paymentRequest.findMany({ where: { montant: between, archived: false }, orderBy: { num: "desc" }, take: 30 });
      for (const request of requests) {
        hits.push({ where: "Demande de paiement", title: `${request.ref} · ${request.beneficiaire}`, detail: `${request.nature}${request.produit ? ` · ${request.produit}` : ""}`, amount: decimalToNumber(request.montant), date: toIsoDate(request.date), state: request.status || "—", href: `/demandes/${request.id}` });
      }
    }
    if (can(actor, "VIR")) {
      const batches = await db.transferBatch.findMany({ where: { OR: [{ credit: between }, { debit: between }] }, orderBy: { updatedAt: "desc" }, take: 20 });
      for (const batch of batches) {
        hits.push({ where: "Envoi de virements", title: batch.ref || batch.fichier, detail: `${batch.nb} virement(s) · ${batch.mois}`, amount: decimalToNumber(batch.credit), date: toIsoDate(batch.updatedAt), state: batch.status || "—", href: `/virements/${batch.id}` });
      }
    }
    return ok(hits);
  } catch (error) {
    console.error("[recherche] montant :", error);
    return fail("La recherche n'a pas pu aboutir.", "DATABASE");
  }
}
