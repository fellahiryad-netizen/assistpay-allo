import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { can, requireAccess } from "@/features/access/services/access-rules";
import type { AuthUser } from "@/features/access/types";
import { toPayable, type PayableInvoice } from "@/features/invoices/services/invoice-balance";
import { writeExtra } from "@/features/invoices/services/invoice-extra";
import { decimalToNumber } from "@/features/invoices/services/invoice-mapper";
import { logAction } from "@/features/journal/services/journal-service";
import type { DoubleEntryInput, LinkExistingInput, NotDoubleInput, TransferLinkInput } from "@/features/statement/schemas";
import { lineRefusals, loadTransfers, transferForLine } from "@/features/statement/services/statement-service";
import type { DoubleEntryCase, DoubleEntryRow, TransferReconciliation } from "@/features/statement/types/double-entry";
import { productLabel, readTransferLines, transferBeneficiaries, type TransferBeneficiary } from "@/features/transfers/services/transfer-lines";
import { fail, ok, type ActionResult } from "@/types";
import { round2 } from "@/utils/amounts";
import { dayGap, toIsoDate } from "@/utils/dates";
import { formatDA, formatDate } from "@/utils/format";
import { nameSimilarity, sameBeneficiary, upperPlain } from "@/utils/text";

/** Contrôle à partir de cette date (comme dans l'ancienne version). */
const DOUBLE_ENTRY_FROM = "2026-08-01";

/** Famille d'un paiement fournisseur : BDG, assistance routière, remboursement. */
function familyOf(invoice: Pick<PayableInvoice, "categorie" | "tiers">): "BDG" | "AR" | "REMB" | "" {
  const text = upperPlain(`${invoice.categorie} ${invoice.tiers}`);
  if (/BDG/.test(text)) return "BDG";
  if (/ASSISTANCE|TPA|DEPANN/.test(text)) return "AR";
  if (/REMBOURSEMENT/.test(text)) return "REMB";
  return "";
}

/** Ligne « globale » (virement global à plusieurs prestataires) — règle de l'ancienne version. */
export function isGlobalRow(invoice: Pick<PayableInvoice, "tiers" | "libelle" | "extra">): boolean {
  if (invoice.extra.global) return true;
  const tiers = upperPlain(invoice.tiers);
  const libelle = upperPlain(invoice.libelle);
  return (
    /^(ALLO ASSISTANCE|DIVERS|GLOBAL|PRESTATAIRES?\b|REMBOURSEMENTS? CLIENTS?$|VIRT)/.test(tiers) ||
    /\bDIVERS\b|GLOBAL/.test(tiers) ||
    (!tiers && /DIVERS|GLOBAL|VIRT REGLEMENT PRESTATAIRES/.test(libelle))
  );
}

function isIncluded(invoice: PayableInvoice): boolean {
  const value = invoice.extra.inclusDans;
  return Array.isArray(value) ? value.length > 0 : Boolean(value);
}

/** Ligne saisie par prestataire (demande de paiement, import). */
function isDetailRow(invoice: PayableInvoice): boolean {
  return !isGlobalRow(invoice) && !isIncluded(invoice) && (invoice.paymentRefs.length > 0 || /demande de paiement|import|canevas/i.test(invoice.origine));
}

function rowOf(invoice: PayableInvoice): DoubleEntryRow {
  return {
    id: invoice.id,
    date: invoice.dateOperation ?? invoice.dateFacture,
    label: `${invoice.tiers || invoice.categorie}${invoice.numero ? ` · ${invoice.numero}` : ""}${invoice.paymentRefs[0] ? ` · DP ${invoice.paymentRefs[0]}` : ""}${invoice.libelle ? ` – ${invoice.libelle.slice(0, 70)}` : ""}`,
    montant: invoice.montant,
    montantGlobal: invoice.montantGlobal,
  };
}

/** Sous-ensemble de lignes dont la somme vaut le montant (± 1 DA). */
function subsetSum<T extends { montant: number }>(candidates: T[], target: number): T[] | null {
  const pool = candidates.slice(0, 40);
  const goal = Math.round(target * 100);
  const reach = new Map<number, T[]>([[0, []]]);
  for (const item of pool) {
    const value = Math.round(item.montant * 100);
    const additions: Array<[number, T[]]> = [];
    for (const [sum, list] of reach) {
      const next = sum + value;
      if (next <= goal + 100 && !reach.has(next)) additions.push([next, [...list, item]]);
    }
    for (const [sum, list] of additions) if (!reach.has(sum)) reach.set(sum, list);
    if (reach.size > 300_000) break;
  }
  for (const [sum, list] of reach) if (list.length && Math.abs(sum - goal) <= 100) return list;
  return null;
}

/** Pour chaque prestataire de l'envoi : sa ou ses factures au Débit (montant exact, ou somme exacte). */
function matchBeneficiaries(beneficiaries: TransferBeneficiary[], pool: PayableInvoice[]): Array<{ beneficiary: TransferBeneficiary; rows: PayableInvoice[]; candidates: PayableInvoice[] }> {
  const used = new Set<string>();
  return beneficiaries.map((beneficiary) => {
    const mine = pool.filter((invoice) => !used.has(invoice.id) && (nameSimilarity(invoice.tiers || invoice.libelle, beneficiary.nom) >= 0.99 || sameBeneficiary(invoice.tiers, beneficiary.nom)));
    let rows: PayableInvoice[] | null = null;
    const single = mine.find((invoice) => Math.abs(invoice.montant - beneficiary.montant) <= 1);
    if (single) rows = [single];
    else if (mine.length > 1) rows = subsetSum(mine, beneficiary.montant);
    for (const row of rows ?? []) used.add(row.id);
    return { beneficiary, rows: rows ?? [], candidates: mine };
  });
}

async function linkedLegacyIds(): Promise<Set<string>> {
  const lines = await db.bankStatementLine.findMany({ where: { invoiceRefs: { isEmpty: false } }, select: { invoiceRefs: true } });
  return new Set(lines.flatMap((line) => line.invoiceRefs.map((ref) => ref.split(":")[0] ?? "")));
}

async function debitPool(date: string, linked: Set<string>): Promise<PayableInvoice[]> {
  const rows = await db.invoice.findMany({ where: { sens: "DEBIT", status: { not: "ANNULE" }, payroll: false, montant: { gt: 0 } } });
  return rows
    .map(toPayable)
    .filter((invoice) => !isGlobalRow(invoice) && !isIncluded(invoice) && !linked.has(invoice.legacyId))
    .filter((invoice) => {
      const when = invoice.dateOperation ?? invoice.dateFacture;
      return !when || dayGap(when, date) <= 75;
    });
}

/** Débits globaux du relevé reconnus comme envois de virements, avec le détail par prestataire. */
export async function listTransferReconciliations(actor: AuthUser): Promise<ActionResult<TransferReconciliation[]>> {
  const guard = requireAccess(actor, "RELEVE");
  if (!guard.success) return guard;
  try {
    const [lines, transfers, linked] = await Promise.all([
      db.bankStatementLine.findMany({ where: { sens: "DEBIT", status: "A_TRAITER" }, orderBy: { date: "desc" } }),
      loadTransfers(),
      linkedLegacyIds(),
    ]);
    const out: TransferReconciliation[] = [];
    for (const line of lines) {
      const montant = decimalToNumber(line.montant);
      const transfer = transferForLine({ sens: "DEBIT", montant }, transfers, lineRefusals(line.extra));
      if (!transfer) continue;
      const batch = await db.transferBatch.findUnique({ where: { id: transfer.id } });
      if (!batch) continue;
      const date = toIsoDate(line.date) ?? "";
      const pool = await debitPool(date, linked);
      const matches = matchBeneficiaries(transferBeneficiaries(readTransferLines(batch.lines)), pool);
      const existingRows = await db.invoice.findMany({
        where: { sens: "DEBIT", status: { not: "ANNULE" }, OR: [{ montant: line.montant }, { montantGlobal: line.montant }] },
      });
      const existing = existingRows
        .map(toPayable)
        .filter((invoice) => !linked.has(invoice.legacyId) && (!invoice.dateOperation || dayGap(invoice.dateOperation, date) <= 15));
      out.push({
        lineId: line.id,
        date,
        libelle: line.libelle,
        montant,
        batch: { id: batch.id, ref: batch.ref, produit: productLabel(batch.type), mois: batch.mois, annee: batch.annee, nb: batch.nb },
        beneficiaries: matches.map((match) => ({
          nom: match.beneficiary.nom,
          montant: match.beneficiary.montant,
          count: match.beneficiary.count,
          invoices: match.rows.map((row) => ({ id: row.id, label: row.numero || row.libelle || "sans n°", montant: row.montant })),
          otherCandidates: match.rows.length ? 0 : match.candidates.length,
        })),
        existing: existing.map((invoice) => ({ id: invoice.id, label: rowOf(invoice).label, montant: invoice.montantGlobal ?? invoice.montant, date: invoice.dateOperation })),
      });
    }
    return ok(out);
  } catch (error) {
    console.error("[double-emploi] rapprochements :", error);
    return fail("Les rapprochements n'ont pas pu être calculés.", "DATABASE");
  }
}

/**
 * Rapproche un débit global de l'envoi de virements, prestataire par prestataire :
 * factures retrouvées passées réglées à la date du relevé, lignes créées pour les prestataires sans facture.
 * Aucun montant global n'est ajouté au Débit, donc pas de double emploi.
 */
export async function applyTransferReconciliation(actor: AuthUser, input: TransferLinkInput): Promise<ActionResult<{ found: number; created: number }>> {
  const guard = requireAccess(actor, "RELEVE", "EDIT");
  if (!guard.success) return guard;
  const access = requireAccess(actor, "FFOUR", "EDIT");
  if (!access.success) return access;
  try {
    const [line, batch, linked] = await Promise.all([
      db.bankStatementLine.findUnique({ where: { id: input.lineId } }),
      db.transferBatch.findUnique({ where: { id: input.batchId } }),
      linkedLegacyIds(),
    ]);
    if (!line || !batch) return fail("Ligne du relevé ou envoi introuvable.", "NOT_FOUND");
    if (line.status !== "A_TRAITER") return fail("Cette ligne du relevé est déjà traitée.", "CONFLICT");
    if (Math.abs(decimalToNumber(batch.debit) - decimalToNumber(line.montant)) >= 0.01) return fail("Le montant de l'envoi ne correspond pas à ce débit.", "VALIDATION");
    const date = toIsoDate(line.date) ?? "";
    const matches = matchBeneficiaries(transferBeneficiaries(readTransferLines(batch.lines)), await debitPool(date, linked));
    const categorie = batch.type === "B" ? "Prestataire BDG" : "Prestataire assistance routière";
    let found = 0;
    let created = 0;
    await db.$transaction(async (tx) => {
      const refs: string[] = [];
      for (const match of matches) {
        if (match.rows.length) {
          for (const row of match.rows) {
            await tx.invoice.update({
              where: { id: row.id },
              data: { status: "REGLE", dateOperation: line.date, mode: "VIREMENT", extra: writeExtra({ ...row.extra, envoi: batch.legacyId }), updatedById: actor.id },
            });
            refs.push(`${row.legacyId}:tout`);
            found += 1;
          }
        } else {
          const legacyId = `env-${crypto.randomUUID()}`;
          await tx.invoice.create({
            data: {
              legacyId,
              sens: "DEBIT",
              status: "REGLE",
              categorie,
              tiers: match.beneficiary.nom,
              libelle: `Virement « ${batch.ref} » – ${match.beneficiary.nom}${match.beneficiary.count > 1 ? ` (${match.beneficiary.count} virements)` : ""}`,
              montant: match.beneficiary.montant,
              dateOperation: line.date,
              annee: line.date.getUTCFullYear(),
              mode: "VIREMENT",
              nature: "Charge",
              classe: 6,
              origine: `relevé · détail de l'envoi ${batch.ref}`,
              extra: { envoi: batch.legacyId },
              createdById: actor.id,
              updatedById: actor.id,
            },
          });
          refs.push(`${legacyId}:tout`);
          created += 1;
        }
      }
      await tx.bankStatementLine.update({ where: { id: line.id }, data: { status: "RAPPROCHE", invoiceRefs: refs } });
    });
    await logAction(
      actor,
      "Rapprochement relevé ↔ détail des virements",
      `${formatDate(date)} – ${formatDA(decimalToNumber(line.montant))} – envoi ${batch.ref} : ${found} facture(s) retrouvée(s), ${created} ligne(s) créée(s)`,
    );
    return ok({ found, created });
  } catch (error) {
    console.error("[double-emploi] application :", error);
    return fail("Le rapprochement n'a pas pu être enregistré.", "DATABASE");
  }
}

/** Rapproche un débit du relevé d'une ligne déjà saisie au Débit (paiement global déjà enregistré). */
export async function linkExistingDebit(actor: AuthUser, input: LinkExistingInput): Promise<ActionResult<true>> {
  const guard = requireAccess(actor, "RELEVE", "EDIT");
  if (!guard.success) return guard;
  const [line, invoice] = await Promise.all([db.bankStatementLine.findUnique({ where: { id: input.lineId } }), db.invoice.findUnique({ where: { id: input.invoiceId } })]);
  if (!line || !invoice) return fail("Ligne ou facture introuvable.", "NOT_FOUND");
  await db.bankStatementLine.update({ where: { id: line.id }, data: { status: "DEJA", invoiceRefs: [`${invoice.legacyId}:tout`] } });
  await logAction(actor, "Rapprochement relevé ↔ Débit existant", `${formatDate(toIsoDate(line.date))} – ${formatDA(decimalToNumber(line.montant))} → ${invoice.tiers || invoice.categorie}`);
  return ok(true);
}

/** « C'est un autre virement » : ce débit n'est pas cet envoi ; il ne sera plus proposé. */
export async function refuseTransfer(actor: AuthUser, input: TransferLinkInput): Promise<ActionResult<true>> {
  const guard = requireAccess(actor, "RELEVE", "EDIT");
  if (!guard.success) return guard;
  const line = await db.bankStatementLine.findUnique({ where: { id: input.lineId } });
  if (!line) return fail("Ligne du relevé introuvable.", "NOT_FOUND");
  const base = line.extra && typeof line.extra === "object" && !Array.isArray(line.extra) ? (line.extra as Prisma.JsonObject) : {};
  const refused = [...new Set([...lineRefusals(line.extra), input.batchId])];
  await db.bankStatementLine.update({ where: { id: line.id }, data: { extra: { ...base, envoiNon: refused } } });
  await logAction(actor, "Relevé : autre virement", `${formatDate(toIsoDate(line.date))} – ${formatDA(decimalToNumber(line.montant))}`);
  return ok(true);
}

/**
 * Doubles emplois au Débit : deux virements globaux identiques à moins de 10 jours,
 * ou un virement global qui recouvre des lignes déjà saisies par prestataire dans les 40 jours précédents.
 */
export async function listDoubleEntries(actor: AuthUser): Promise<ActionResult<DoubleEntryCase[]>> {
  const guard = requireAccess(actor, "FFOUR");
  if (!guard.success) return guard;
  try {
    const [rows, transfers] = await Promise.all([db.invoice.findMany({ where: { sens: "DEBIT", status: { not: "ANNULE" }, payroll: false } }), loadTransfers()]);
    const debits = rows
      .map(toPayable)
      .filter((invoice) => (invoice.dateOperation ?? invoice.dateFacture ?? "") >= DOUBLE_ENTRY_FROM && familyOf(invoice) !== "");
    const globals = debits.filter(isGlobalRow);
    const details = debits.filter(isDetailRow);
    const out: DoubleEntryCase[] = [];
    for (let i = 0; i < globals.length; i += 1) {
      for (let j = i + 1; j < globals.length; j += 1) {
        const a = globals[i];
        const b = globals[j];
        if (!a || !b || !a.dateOperation || !b.dateOperation) continue;
        if (familyOf(a) !== familyOf(b)) continue;
        if (Math.abs((a.montantGlobal ?? a.montant) - (b.montantGlobal ?? b.montant)) > 10 || dayGap(a.dateOperation, b.dateOperation) > 10) continue;
        if ((a.extra.dblOkWith ?? []).includes(b.id) || (b.extra.dblOkWith ?? []).includes(a.id)) continue;
        out.push({ kind: "pair", a: rowOf(a), b: rowOf(b) });
      }
    }
    for (const global of globals) {
      if (global.extra.dblOk || !global.dateOperation) continue;
      const when = global.dateOperation;
      const candidates = details
        .filter((row) => familyOf(row) === familyOf(global) && row.dateOperation && row.dateOperation <= when && dayGap(row.dateOperation, when) <= 40)
        .sort((a, b) => (b.dateOperation ?? "").localeCompare(a.dateOperation ?? ""));
      if (!candidates.length) continue;
      const exact = subsetSum(candidates, global.montant);
      const transfer = transfers.find((batch) => batch.debit > 0 && Math.abs(batch.debit - (global.montantGlobal ?? global.montant)) <= 1) ?? null;
      let preselected = (exact ?? []).map((row) => row.id);
      if (transfer) {
        const batch = await db.transferBatch.findUnique({ where: { id: transfer.id } });
        if (batch) {
          const fromTransfer = matchBeneficiaries(transferBeneficiaries(readTransferLines(batch.lines)), candidates).flatMap((match) => match.rows.map((row) => row.id));
          if (fromTransfer.length) preselected = fromTransfer;
        }
      }
      out.push({ kind: "global", global: rowOf(global), candidates: candidates.map(rowOf), preselected, exact: Boolean(exact), transferRef: transfer?.ref ?? null });
    }
    return ok(out);
  } catch (error) {
    console.error("[double-emploi] analyse :", error);
    return fail("Le contrôle de double emploi a échoué.", "DATABASE");
  }
}

/** Valide un double emploi : les lignes détaillées sont rattachées au global, réduit d'autant. */
export async function applyDoubleEntry(actor: AuthUser, input: DoubleEntryInput): Promise<ActionResult<{ remaining: number }>> {
  const guard = requireAccess(actor, "FFOUR", "EDIT");
  if (!guard.success) return guard;
  try {
    const globalRow = await db.invoice.findUnique({ where: { id: input.globalId } });
    if (!globalRow) return fail("Virement global introuvable.", "NOT_FOUND");
    const global = toPayable(globalRow);
    const detailRows = await db.invoice.findMany({ where: { id: { in: input.detailIds }, sens: "DEBIT" } });
    const original = global.montantGlobal ?? global.montant;
    const detailIds = [...new Set([...(global.extra.detail ?? []), ...detailRows.map((row) => row.id)])];
    const allDetails = await db.invoice.findMany({ where: { id: { in: detailIds } }, select: { montant: true } });
    const rest = round2(original - allDetails.reduce((sum, row) => sum + decimalToNumber(row.montant), 0));
    if (rest < -1) return fail(`Les lignes cochées dépassent le virement global de ${formatDA(-rest)}.`, "VALIDATION");
    await db.$transaction(async (tx) => {
      await tx.invoice.update({
        where: { id: global.id },
        data: { montantGlobal: original, montant: Math.max(0, rest), extra: writeExtra({ ...global.extra, detail: detailIds, dblOk: true }), updatedById: actor.id },
      });
      for (const row of detailRows) {
        const payable = toPayable(row);
        await tx.invoice.update({ where: { id: row.id }, data: { extra: writeExtra({ ...payable.extra, inclusDans: global.id }), updatedById: actor.id } });
      }
    });
    await logAction(actor, "Contrôle double emploi", `${detailRows.length} ligne(s) rattachée(s) au global ${global.tiers} : ${formatDA(original)} → ${formatDA(Math.max(0, rest))}`);
    return ok({ remaining: Math.max(0, rest) });
  } catch (error) {
    console.error("[double-emploi] validation :", error);
    return fail("Le double emploi n'a pas pu être validé.", "DATABASE");
  }
}

/** « Ce n'est pas un doublon » : pour une paire de globaux, ou pour un global et ses lignes. */
export async function markNotDouble(actor: AuthUser, input: NotDoubleInput): Promise<ActionResult<true>> {
  const guard = requireAccess(actor, "FFOUR", "EDIT");
  if (!guard.success) return guard;
  const rows = await db.invoice.findMany({ where: { id: { in: input.ids } } });
  if (rows.length !== input.ids.length) return fail("Ligne introuvable.", "NOT_FOUND");
  await db.$transaction(async (tx) => {
    for (const row of rows) {
      const payable = toPayable(row);
      const extra =
        input.ids.length === 2
          ? { ...payable.extra, dblOkWith: [...new Set([...(payable.extra.dblOkWith ?? []), ...input.ids.filter((id) => id !== row.id)])] }
          : { ...payable.extra, dblOk: true };
      await tx.invoice.update({ where: { id: row.id }, data: { extra: writeExtra(extra) } });
    }
  });
  await logAction(actor, "Contrôle double emploi", `Noté comme autre virement : ${rows.map((row) => row.tiers || row.categorie).join(" / ")}`);
  return ok(true);
}

/** Nombre de cas à examiner (badge du menu). */
export async function countDoubleEntryWork(actor: AuthUser): Promise<number> {
  if (!can(actor, "RELEVE") && !can(actor, "FFOUR")) return 0;
  const [transfers, doubles] = await Promise.all([
    can(actor, "RELEVE") ? listTransferReconciliations(actor) : Promise.resolve(ok<TransferReconciliation[]>([])),
    can(actor, "FFOUR") ? listDoubleEntries(actor) : Promise.resolve(ok<DoubleEntryCase[]>([])),
  ]);
  return (transfers.success ? transfers.data.length : 0) + (doubles.success ? doubles.data.length : 0);
}
