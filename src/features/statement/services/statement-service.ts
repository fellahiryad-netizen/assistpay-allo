import { db } from "@/lib/db";
import { readWorkbook } from "@/lib/spreadsheet";
import type { Prisma } from "@/generated/prisma/client";
import { can, requireAccess } from "@/features/access/services/access-rules";
import type { AuthUser } from "@/features/access/types";
import { paymentOptions, remaining, settle, toPayable, type PayableInvoice, type PaymentInfo, type PaymentPart } from "@/features/invoices/services/invoice-balance";
import { writeExtra } from "@/features/invoices/services/invoice-extra";
import { decimalToNumber } from "@/features/invoices/services/invoice-mapper";
import { isPayrollInvoice, moduleForSens } from "@/features/invoices/services/invoice-rules";
import { logAction } from "@/features/journal/services/journal-service";
import type { ApplyProposalsInput, AssignLineInput, CreateFromLineInput, StatementQuery } from "@/features/statement/schemas";
import { analyseLines, inFamily } from "@/features/statement/services/statement-matching";
import {
  BANK_FEE_PATTERN,
  PAYROLL_PATTERN,
  detectHeaderRow,
  guessMapping,
  previewRows,
  readStatementLines,
  statementLineKey,
} from "@/features/statement/services/statement-parser";
import type {
  AssignCandidate,
  BankPaymentType,
  ColumnMapping,
  ParsedLine,
  StatementAnalysis,
  StatementLineDTO,
  StatementPreview,
} from "@/features/statement/types";
import { productLabel } from "@/features/transfers/services/transfer-lines";
import { fail, ok, type ActionResult, type Paginated } from "@/types";
import { round2 } from "@/utils/amounts";
import { dayGap, fromIsoDate, shiftIsoDate, toIsoDate } from "@/utils/dates";
import { formatDA, formatDate } from "@/utils/format";
import { upperPlain } from "@/utils/text";

const PAGE_SIZE = 50;

/** Fichier envoyé par le navigateur. */
export interface UploadedFile {
  name: string;
  bytes: Uint8Array;
}

/** Mode de paiement bancaire → mode de règlement d'une facture. */
export function bankTypeToMode(type: string): PaymentInfo["mode"] {
  if (type === "CHEQUE") return "CHEQUE";
  if (type === "VIRMT") return "VIREMENT";
  if (type === "VRSMT") return "VERSEMENT";
  return null;
}

function guardEdit(actor: AuthUser): ActionResult<true> {
  return requireAccess(actor, "RELEVE", "EDIT");
}

function firstSheetRows(file: UploadedFile): ActionResult<{ rows: ReturnType<typeof readWorkbook>[number]["rows"] }> {
  try {
    const sheets = readWorkbook(file.bytes);
    const first = sheets[0];
    if (!first || first.rows.length === 0) return fail("Le fichier est vide.", "VALIDATION");
    return ok({ rows: first.rows });
  } catch (error) {
    console.error("[releve] lecture du fichier :", error);
    return fail("Ce fichier n'a pas pu être lu. Exportez le relevé en Excel ou CSV depuis votre banque en ligne.", "VALIDATION");
  }
}

/** Lit le fichier de la banque et propose la correspondance des colonnes. */
export async function previewStatement(actor: AuthUser, file: UploadedFile): Promise<ActionResult<StatementPreview>> {
  const guard = guardEdit(actor);
  if (!guard.success) return guard;
  const sheet = firstSheetRows(file);
  if (!sheet.success) return sheet;
  const headerRow = detectHeaderRow(sheet.data.rows);
  const headers = (sheet.data.rows[headerRow] ?? []).map((cell, index) => (cell === null || cell === undefined || String(cell).trim() === "" ? `Colonne ${index + 1}` : String(cell).trim()));
  return ok({
    fileName: file.name,
    headerRow,
    headers,
    mapping: guessMapping(headers),
    sample: previewRows(sheet.data.rows, headerRow + 1, 5),
    rowCount: Math.max(0, sheet.data.rows.length - headerRow - 1),
  });
}

/** Envoi de virements résumé. */
export interface TransferRef {
  id: string;
  ref: string;
  type: string;
  nb: number;
  mois: string;
  debit: number;
}

/** Envois de virements non rejetés (pour reconnaître les débits globaux). */
export async function loadTransfers(): Promise<TransferRef[]> {
  const batches = await db.transferBatch.findMany({ where: { status: { not: "rejete" } }, select: { id: true, ref: true, type: true, nb: true, mois: true, debit: true } });
  return batches.map((batch) => ({ ...batch, debit: decimalToNumber(batch.debit) }));
}

/** Envois refusés pour cette ligne (« c'est un autre virement »). */
export function lineRefusals(extra: Prisma.JsonValue): string[] {
  if (extra && typeof extra === "object" && !Array.isArray(extra)) {
    const value = (extra as Record<string, unknown>).envoiNon;
    if (Array.isArray(value)) return value.map(String);
  }
  return [];
}

/** Envoi de virements dont le total débit est égal au montant de la ligne (au centime). */
export function transferForLine(line: { sens: "CREDIT" | "DEBIT"; montant: number }, transfers: TransferRef[], refused: string[]): TransferRef | null {
  if (line.sens !== "DEBIT") return null;
  return transfers.find((batch) => batch.debit > 0 && Math.abs(batch.debit - line.montant) < 0.01 && !refused.includes(batch.id)) ?? null;
}

async function linkedInvoiceIds(): Promise<Set<string>> {
  const lines = await db.bankStatementLine.findMany({ where: { invoiceRefs: { isEmpty: false } }, select: { invoiceRefs: true } });
  const legacy = new Set(lines.flatMap((line) => line.invoiceRefs.map((ref) => ref.split(":")[0] ?? "")).filter((ref) => ref && !ref.startsWith("rh")));
  if (legacy.size === 0) return new Set();
  const rows = await db.invoice.findMany({ where: { legacyId: { in: [...legacy] } }, select: { id: true } });
  return new Set(rows.map((row) => row.id));
}

/** Enregistre (ou met à jour) une ligne de relevé à partir de sa clé stable. */
export async function upsertLine(line: ParsedLine, status: "A_TRAITER" | "RAPPROCHE" | "DEJA" | "IGNORE" | "AJOUTE", refs: string[], actor: AuthUser): Promise<void> {
  const date = fromIsoDate(line.date);
  if (!date) return;
  const data = {
    date,
    libelle: line.libelle,
    montant: line.montant,
    sens: line.sens,
    numero: line.numero,
    type: line.type,
    status,
    invoiceRefs: refs,
  };
  await db.bankStatementLine.upsert({
    where: { legacyId: line.key },
    create: { legacyId: line.key, ...data, extra: { par: actor.name } },
    update: data,
  });
}

/**
 * Analyse un relevé : lit les opérations, écarte les frais bancaires, reconnaît les lignes déjà importées,
 * propose les rapprochements avec les factures en attente et repère les paiements déjà enregistrés.
 * Les lignes sans correspondance sont enregistrées « à traiter » ; les paiements déjà présents « déjà enregistrés ».
 */
export async function analyseStatement(actor: AuthUser, file: UploadedFile, mapping: ColumnMapping): Promise<ActionResult<StatementAnalysis>> {
  const guard = guardEdit(actor);
  if (!guard.success) return guard;
  const sheet = firstSheetRows(file);
  if (!sheet.success) return sheet;
  const all = readStatementLines(sheet.data.rows, detectHeaderRow(sheet.data.rows), mapping);
  if (all.length === 0) return fail("Aucune ligne avec une date et un montant n'a été trouvée. Vérifiez les colonnes choisies.", "VALIDATION");
  return analyseParsed(actor, all);
}

async function analyseParsed(actor: AuthUser, all: ParsedLine[]): Promise<ActionResult<StatementAnalysis>> {
  try {
    const fees = all.filter((line) => line.sens === "DEBIT" && BANK_FEE_PATTERN.test(upperPlain(line.libelle)));
    const kept = all.filter((line) => !fees.includes(line));
    const known = await db.bankStatementLine.findMany({ where: { legacyId: { in: kept.map((line) => line.key) } }, select: { legacyId: true, status: true } });
    const knownStatus = new Map(known.map((line) => [line.legacyId, line.status]));
    const fresh = kept.filter((line) => {
      const status = knownStatus.get(line.key);
      return !status || status === "A_TRAITER";
    });
    const alreadyImported = kept.length - fresh.length;
    const transfers = await loadTransfers();
    const payrollLines = fresh.filter((line) => PAYROLL_PATTERN.test(upperPlain(line.libelle)) && !transferForLine(line, transfers, []));
    const business = fresh.filter((line) => !payrollLines.includes(line));

    const dates = business.map((line) => line.date).sort();
    const from = shiftIsoDate(dates[0] ?? "2000-01-01", -75);
    const to = shiftIsoDate(dates[dates.length - 1] ?? "2100-01-01", 75);
    const [pendingRows, recordedRows, linked] = await Promise.all([
      db.invoice.findMany({ where: { status: "EN_ATTENTE", payroll: false } }),
      db.invoice.findMany({
        where: {
          payroll: false,
          OR: [{ status: "REGLE", dateOperation: { gte: fromIsoDate(from) ?? undefined, lte: fromIsoDate(to) ?? undefined } }, { status: "EN_ATTENTE", cheque: { not: "" } }],
        },
      }),
      linkedInvoiceIds(),
    ]);
    const pending = pendingRows.map(toPayable).filter((invoice) => can(actor, moduleForSens(invoice.sens), "EDIT"));
    const recorded = recordedRows.map(toPayable);
    const result = analyseLines({
      lines: business,
      pending,
      recorded,
      linkedInvoiceIds: linked,
      transferFor: (line) => transferForLine(line, transfers, [])?.ref ?? null,
    });

    // Lignes de paie : déjà enregistrées dans les écritures RH ?
    const hrRows = payrollLines.length
      ? await db.hrEntry.findMany({ where: { date: { gte: fromIsoDate(shiftIsoDate(payrollLines.map((l) => l.date).sort()[0] ?? from, -10)) ?? undefined } } })
      : [];
    const usedHr = new Set<string>();
    const hrRecorded: StatementAnalysis["recorded"] = [];
    const hrTodo: ParsedLine[] = [];
    for (const line of payrollLines) {
      const match = hrRows.find(
        (entry) =>
          !usedHr.has(entry.id) &&
          Math.abs(decimalToNumber(entry.montant) - line.montant) <= 0.5 &&
          (entry.sens === "RETOUR") === (line.sens === "CREDIT") &&
          entry.date !== null &&
          dayGap(toIsoDate(entry.date) ?? line.date, line.date) <= 10,
      );
      if (match) {
        usedHr.add(match.id);
        hrRecorded.push({ line, labels: [`RH : ${match.nature} ${match.beneficiaire}`.trim()] });
        await upsertLine(line, "DEJA", [`rh:${match.legacyId}`], actor);
      } else {
        hrTodo.push(line);
      }
    }

    for (const line of [...result.todo, ...hrTodo]) {
      if (!knownStatus.has(line.key)) await upsertLine(line, "A_TRAITER", [], actor);
    }
    for (const match of result.recorded) {
      await upsertLine(match.line, "DEJA", match.invoices.map((invoice) => `${invoice.legacyId}:tout`), actor);
    }
    await logAction(
      actor,
      "Import du relevé bancaire",
      `${all.length} lignes : ${result.proposals.length} à valider, ${result.recorded.length + hrRecorded.length} déjà enregistrées, ${result.todo.length + hrTodo.length} à traiter`,
    );
    return ok({
      total: all.length,
      proposals: result.proposals,
      recorded: [...result.recorded.map(({ line, labels }) => ({ line, labels })), ...hrRecorded],
      todo: [...result.todo, ...hrTodo],
      alreadyImported,
      bankFees: { count: fees.length, amount: round2(fees.reduce((sum, line) => sum + line.montant, 0)) },
      payrollLines: payrollLines.length,
    });
  } catch (error) {
    console.error("[releve] analyse :", error);
    return fail("L'analyse du relevé a échoué.", "DATABASE");
  }
}

/** Relance le rapprochement sur toutes les lignes « à traiter » (après de nouvelles saisies). */
export async function recheckTodo(actor: AuthUser): Promise<ActionResult<StatementAnalysis>> {
  const guard = guardEdit(actor);
  if (!guard.success) return guard;
  const rows = await db.bankStatementLine.findMany({ where: { status: "A_TRAITER" } });
  if (rows.length === 0) return fail("Aucune ligne à revérifier.", "NOT_FOUND");
  const lines: ParsedLine[] = rows.map((row) => ({
    key: row.legacyId,
    date: toIsoDate(row.date) ?? "",
    libelle: row.libelle,
    montant: decimalToNumber(row.montant),
    sens: row.sens,
    type: (["CHEQUE", "VIRMT", "VRSMT"].includes(row.type) ? row.type : "") as BankPaymentType,
    numero: row.numero,
  }));
  return analyseParsed(actor, lines);
}

/** Applique un règlement à une facture dans une transaction et renvoie la référence « legacyId:partie ». */
async function settleInvoice(
  tx: Prisma.TransactionClient,
  actor: AuthUser,
  invoiceId: string,
  part: PaymentPart,
  payment: PaymentInfo,
  amount: number | undefined,
): Promise<ActionResult<string>> {
  const row = await tx.invoice.findUnique({ where: { id: invoiceId } });
  if (!row) return fail("Facture introuvable.", "NOT_FOUND");
  const invoice = toPayable(row);
  if (!can(actor, moduleForSens(invoice.sens), "EDIT") || (invoice.payroll && !can(actor, "RH", "EDIT"))) {
    return fail(`Vous ne pouvez pas régler la facture ${invoice.numero || invoice.tiers}.`, "FORBIDDEN");
  }
  const options = paymentOptions(invoice, new Set());
  if (!options.some((option) => option.part === part)) return fail(`La facture ${invoice.numero || invoice.tiers} est déjà réglée.`, "CONFLICT");
  const change = settle(invoice, part, payment, amount);
  await tx.invoice.update({
    where: { id: invoiceId },
    data: {
      status: change.status,
      dateOperation: fromIsoDate(change.dateOperation),
      mode: change.mode,
      cheque: change.cheque,
      ...(change.banque ? { banque: change.banque } : {}),
      extra: writeExtra(change.extra),
      updatedById: actor.id,
    },
  });
  return ok(`${invoice.legacyId}:${part}`);
}

/** Valide les propositions cochées : factures réglées à la date du relevé, lignes « rapprochées ». */
export async function applyProposals(actor: AuthUser, input: ApplyProposalsInput): Promise<ActionResult<{ invoices: number; lines: number }>> {
  const guard = guardEdit(actor);
  if (!guard.success) return guard;
  let invoices = 0;
  let lines = 0;
  try {
    for (const proposal of input.proposals) {
      const line = proposal.line;
      if (statementLineKey(line) !== line.key) return fail("Une ligne du relevé a été modifiée : relancez l'analyse.", "VALIDATION");
      const payment: PaymentInfo = { date: line.date, mode: bankTypeToMode(line.type), numero: line.numero };
      const single = proposal.items.length === 1 ? proposal.items[0] : undefined;
      const outcome = await db.$transaction(async (tx) => {
        const refs: string[] = [];
        for (const item of proposal.items) {
          const partialAmount = single ? line.montant : undefined;
          const settled = await settleInvoice(tx, actor, item.invoiceId, item.part, payment, partialAmount);
          if (!settled.success) throw new Error(settled.error);
          refs.push(settled.data);
        }
        return refs;
      });
      await upsertLine(line, "RAPPROCHE", outcome, actor);
      invoices += outcome.length;
      lines += 1;
    }
    await logAction(actor, "Rapprochement du relevé", `${lines} paiement(s) validé(s), ${invoices} facture(s) réglée(s)`);
    return ok({ invoices, lines });
  } catch (error) {
    console.error("[releve] validation :", error);
    const message = error instanceof Error && error.message ? error.message : "La validation a échoué.";
    return fail(`${message} (${lines} paiement(s) déjà validé(s) avant l'erreur.)`, "CONFLICT");
  }
}

function toLineDTO(
  row: Prisma.BankStatementLineGetPayload<Record<string, never>>,
  transfers: TransferRef[],
  twins: Map<string, string>,
): StatementLineDTO {
  const montant = decimalToNumber(row.montant);
  const transfer = row.status === "A_TRAITER" ? transferForLine({ sens: row.sens, montant }, transfers, lineRefusals(row.extra)) : null;
  return {
    id: row.id,
    legacyId: row.legacyId,
    date: toIsoDate(row.date) ?? "",
    libelle: row.libelle,
    montant,
    sens: row.sens,
    type: row.type,
    numero: row.numero,
    status: row.status,
    invoiceRefs: row.invoiceRefs,
    importedAt: row.importedAt.toISOString(),
    twinDate: twins.get(row.id) ?? null,
    transfer: transfer ? { id: transfer.id, ref: transfer.ref, produit: productLabel(transfer.type), nb: transfer.nb, mois: transfer.mois } : null,
    payroll: PAYROLL_PATTERN.test(upperPlain(row.libelle)),
  };
}

/** Lignes du relevé (filtrées, paginées) avec doublons probables et envois de virements reconnus. */
export async function listStatementLines(
  actor: AuthUser,
  query: StatementQuery,
): Promise<ActionResult<Paginated<StatementLineDTO> & { counts: Record<string, number>; canEdit: boolean }>> {
  const guard = requireAccess(actor, "RELEVE");
  if (!guard.success) return guard;
  const where: Prisma.BankStatementLineWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.sens ? { sens: query.sens } : {}),
    ...(query.month
      ? { date: { gte: fromIsoDate(`${query.month}-01`) ?? undefined, lt: fromIsoDate(shiftIsoDate(`${query.month}-28`, 7).slice(0, 8) + "01") ?? undefined } }
      : {}),
    ...(query.q ? { OR: [{ libelle: { contains: query.q, mode: "insensitive" } }, { numero: { contains: query.q, mode: "insensitive" } }] } : {}),
  };
  try {
    const [total, rows, grouped, transfers] = await Promise.all([
      db.bankStatementLine.count({ where }),
      db.bankStatementLine.findMany({ where, orderBy: [{ date: "desc" }, { importedAt: "desc" }], skip: (query.page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
      db.bankStatementLine.groupBy({ by: ["status"], _count: { _all: true } }),
      loadTransfers(),
    ]);
    const twins = new Map<string, string>();
    const todo = rows.filter((row) => row.status === "A_TRAITER");
    if (todo.length) {
      const others = await db.bankStatementLine.findMany({
        where: { id: { notIn: todo.map((row) => row.id) }, montant: { in: todo.map((row) => row.montant) } },
        select: { id: true, date: true, libelle: true, montant: true, sens: true },
      });
      for (const row of todo) {
        const twin = others.find(
          (other) =>
            other.sens === row.sens &&
            Math.abs(decimalToNumber(other.montant) - decimalToNumber(row.montant)) <= 0.5 &&
            upperPlain(other.libelle) === upperPlain(row.libelle) &&
            dayGap(toIsoDate(other.date) ?? "", toIsoDate(row.date) ?? "") <= 20,
        );
        if (twin) twins.set(row.id, toIsoDate(twin.date) ?? "");
      }
    }
    return ok({
      items: rows.map((row) => toLineDTO(row, transfers, twins)),
      total,
      page: query.page,
      pageSize: PAGE_SIZE,
      pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
      counts: Object.fromEntries(grouped.map((group) => [group.status, group._count._all])),
      canEdit: can(actor, "RELEVE", "EDIT"),
    });
  } catch (error) {
    console.error("[releve] liste :", error);
    return fail("Le relevé n'a pas pu être chargé.", "DATABASE");
  }
}

async function loadLine(id: string): Promise<ActionResult<Prisma.BankStatementLineGetPayload<Record<string, never>>>> {
  const row = await db.bankStatementLine.findUnique({ where: { id } });
  return row ? ok(row) : fail("Ligne du relevé introuvable.", "NOT_FOUND");
}

function describeLine(row: { date: Date; montant: Prisma.Decimal; libelle: string }): string {
  return `${formatDate(toIsoDate(row.date))} – ${formatDA(decimalToNumber(row.montant))} – ${row.libelle.slice(0, 80)}`;
}

/** Marque une ligne comme ignorée (hors suivi : frais, virements internes…). */
export async function ignoreLine(actor: AuthUser, lineId: string): Promise<ActionResult<true>> {
  const guard = guardEdit(actor);
  if (!guard.success) return guard;
  const line = await loadLine(lineId);
  if (!line.success) return line;
  await db.bankStatementLine.update({ where: { id: lineId }, data: { status: "IGNORE" } });
  await logAction(actor, "Relevé : ligne ignorée", describeLine(line.data));
  return ok(true);
}

/** Remet une ligne « à traiter » (annule un rapprochement manuel ou un « ignorer »). Les factures ne sont pas modifiées. */
export async function reopenLine(actor: AuthUser, lineId: string): Promise<ActionResult<true>> {
  const guard = guardEdit(actor);
  if (!guard.success) return guard;
  const line = await loadLine(lineId);
  if (!line.success) return line;
  await db.bankStatementLine.update({ where: { id: lineId }, data: { status: "A_TRAITER", invoiceRefs: [] } });
  await logAction(actor, "Relevé : ligne remise à traiter", describeLine(line.data));
  return ok(true);
}

/** Factures en attente proposées pour affecter manuellement une ligne (montant exact en premier). */
export async function assignCandidates(actor: AuthUser, lineId: string): Promise<ActionResult<AssignCandidate[]>> {
  const guard = guardEdit(actor);
  if (!guard.success) return guard;
  const line = await loadLine(lineId);
  if (!line.success) return line;
  const montant = decimalToNumber(line.data.montant);
  const rows = await db.invoice.findMany({ where: { status: "EN_ATTENTE", sens: line.data.sens, ...(can(actor, "RH") ? {} : { payroll: false }) } });
  const options = rows
    .map(toPayable)
    .flatMap((invoice) => paymentOptions(invoice, new Set()))
    .map((option) => ({ option, family: inFamily(line.data.libelle, option.invoice) }))
    .sort((a, b) => Math.abs(a.option.amount - montant) - Math.abs(b.option.amount - montant) || Number(b.family) - Number(a.family))
    .slice(0, 80);
  return ok(
    options.map(({ option }) => ({
      invoiceId: option.invoice.id,
      part: option.part,
      amount: option.amount,
      exact: Math.abs(option.amount - montant) <= 0.5,
      label: `${option.invoice.tiers || option.invoice.categorie}${option.invoice.numero ? ` · ${option.invoice.numero}` : ""}${option.invoice.dateFacture ? ` · ${formatDate(option.invoice.dateFacture)}` : ""}${option.part === "debours" ? " (débours)" : option.part === "frais" ? " (frais)" : ""}`,
    })),
  );
}

/**
 * Affecte une ligne à une ou plusieurs factures : chacune passe réglée à la date du relevé.
 * Une seule facture plus élevée que le paiement reçoit un paiement partiel.
 */
export async function assignLine(actor: AuthUser, input: AssignLineInput): Promise<ActionResult<{ invoices: number }>> {
  const guard = guardEdit(actor);
  if (!guard.success) return guard;
  const line = await loadLine(input.lineId);
  if (!line.success) return line;
  const row = line.data;
  const montant = decimalToNumber(row.montant);
  const date = toIsoDate(row.date) ?? "";
  const payment: PaymentInfo = { date, mode: bankTypeToMode(row.type), numero: row.numero };
  try {
    const refs = await db.$transaction(async (tx) => {
      const out: string[] = [];
      let left = montant;
      for (const item of input.items) {
        const invoiceRow = await tx.invoice.findUnique({ where: { id: item.invoiceId } });
        if (!invoiceRow) throw new Error("Facture introuvable.");
        const due = item.part === "tout" ? remaining(toPayable(invoiceRow)) || decimalToNumber(invoiceRow.montant) : item.part === "debours" ? decimalToNumber(invoiceRow.debours) ?? 0 : decimalToNumber(invoiceRow.frais) ?? 0;
        const amount = round2(Math.min(due, Math.max(0, left)));
        const settled = await settleInvoice(tx, actor, item.invoiceId, item.part, payment, item.part === "tout" ? amount : undefined);
        if (!settled.success) throw new Error(settled.error);
        out.push(settled.data);
        left = round2(left - due);
      }
      await tx.bankStatementLine.update({ where: { id: row.id }, data: { status: "RAPPROCHE", invoiceRefs: out } });
      return out;
    });
    await logAction(actor, "Relevé : paiement affecté", `${describeLine(row)} → ${refs.length} facture(s)`);
    return ok({ invoices: refs.length });
  } catch (error) {
    console.error("[releve] affectation :", error);
    return fail(error instanceof Error ? error.message : "L'affectation a échoué.", "CONFLICT");
  }
}

/** Crée la facture correspondant à un paiement absent du suivi (réglée à la date du relevé). */
export async function createInvoiceFromLine(actor: AuthUser, input: CreateFromLineInput): Promise<ActionResult<{ invoiceId: string }>> {
  const guard = guardEdit(actor);
  if (!guard.success) return guard;
  const line = await loadLine(input.lineId);
  if (!line.success) return line;
  const row = line.data;
  const access = requireAccess(actor, moduleForSens(row.sens), "EDIT");
  if (!access.success) return access;
  const payroll = isPayrollInvoice(input.categorie, input.nature);
  if (payroll && !can(actor, "RH", "EDIT")) return fail("Les lignes de paie sont réservées à l'accès RH.", "FORBIDDEN");
  try {
    const legacyId = `rv-${crypto.randomUUID()}`;
    const invoice = await db.$transaction(async (tx) => {
      const created = await tx.invoice.create({
        data: {
          legacyId,
          sens: row.sens,
          status: "REGLE",
          categorie: input.categorie,
          tiers: input.tiers,
          numero: input.numero,
          libelle: input.libelle || row.libelle,
          nature: input.nature || (row.sens === "DEBIT" ? "Charge" : "Production Assistance"),
          montant: row.montant,
          dateOperation: row.date,
          annee: row.date.getUTCFullYear(),
          mode: bankTypeToMode(row.type),
          cheque: row.type === "CHEQUE" ? row.numero : "",
          classe: row.sens === "CREDIT" ? 7 : 6,
          payroll,
          origine: "relevé bancaire",
          createdById: actor.id,
          updatedById: actor.id,
        },
      });
      await tx.bankStatementLine.update({ where: { id: row.id }, data: { status: "AJOUTE", invoiceRefs: [`${legacyId}:tout`] } });
      return created;
    });
    await logAction(actor, "Relevé : paiement ajouté au suivi", `${describeLine(row)} → ${input.tiers}`);
    return ok({ invoiceId: invoice.id });
  } catch (error) {
    console.error("[releve] création :", error);
    return fail("La facture n'a pas pu être créée.", "DATABASE");
  }
}
