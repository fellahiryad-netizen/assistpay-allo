import { db } from "@/lib/db";
import { readWorkbook, writeWorkbook } from "@/lib/spreadsheet";
import type { Prisma, ProviderRib, TransferBatch } from "@/generated/prisma/client";
import { can, requireAccess } from "@/features/access/services/access-rules";
import type { AuthUser } from "@/features/access/types";
import { decimalToNumber } from "@/features/invoices/services/invoice-mapper";
import { logAction } from "@/features/journal/services/journal-service";
import type { DecideBatchInput, SheetInput, UploadCheckOptions } from "@/features/transfers/schemas";
import {
  BANKS,
  DONOR,
  TRANSFER_PRODUCTS,
  accountKey,
  ribParts,
  ribValid,
  splitAmount,
  splitName,
  type TransferProduct,
} from "@/features/transfers/services/rib";
import { getControlSettings } from "@/features/settings/services/settings-service";
import { analyseTransfer, batchSignature, detectTransferSheet, extractTransferLines, type KnownAccount, type TransferKnowledge } from "@/features/transfers/services/transfer-check";
import { productLabel, readTransferLines, storeTransferLine, type TransferLine } from "@/features/transfers/services/transfer-lines";
import type { SheetLine, SheetRequest, TransferAnalysis, TransferBatchDTO } from "@/features/transfers/types";
import { fail, ok, type ActionResult } from "@/types";
import { round2 } from "@/utils/amounts";
import { MONTHS_FR, shiftIsoDate, toIsoDate, todayIso } from "@/utils/dates";
import { formatDA } from "@/utils/format";
import { nameSimilarity, nameTokens, upperPlain } from "@/utils/text";

/** Fichier envoyé par le navigateur. */
export interface TransferFile {
  name: string;
  bytes: Uint8Array;
}

function obj(value: Prisma.JsonValue): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function ribList(value: unknown): string[] {
  return Array.isArray(value) ? value.flatMap((item) => (item && typeof item === "object" && "rib" in item ? [String((item as { rib: unknown }).rib)] : [])) : [];
}

/** Base de connaissance : référentiel RIB et envois non rejetés (historique des virements validés). */
async function loadKnowledge(): Promise<TransferKnowledge & { ribs: ProviderRib[] }> {
  const [ribs, batches, settings] = await Promise.all([db.providerRib.findMany(), db.transferBatch.findMany({ where: { status: { not: "rejete" } } }), getControlSettings()]);
  const accounts = new Map<string, KnownAccount>();
  for (const rib of ribs) {
    const extra = obj(rib.extra);
    accounts.set(rib.key, {
      key: rib.key,
      noms: rib.noms,
      types: rib.types,
      rib: rib.rib,
      oldRibs: ribList(extra.anciens),
      refusedRibs: ribList(extra.refuses),
      status: rib.status,
      history: [],
    });
  }
  const known = batches.map((batch) => {
    const lines = readTransferLines(batch.lines);
    if (batch.status === "valide") {
      for (const line of lines) {
        if (line.sens !== "C") continue;
        const account = accounts.get(`${line.banque}${line.compte}`);
        if (account) account.history.push({ batchId: batch.id, ref: batch.ref, mois: batch.mois, amount: line.montant });
      }
    }
    return { id: batch.id, ref: batch.ref, mois: batch.mois, src: String(obj(batch.extra).src ?? ""), status: batch.status, signature: batchSignature(lines) };
  });
  const byName = new Map<string, Set<string>>();
  for (const account of accounts.values()) {
    if (account.status === "supprime") continue;
    for (const name of account.noms) {
      const key = nameTokens(name).sort().join(" ");
      if (!key) continue;
      byName.set(key, new Set([...(byName.get(key) ?? []), account.key]));
    }
  }
  return { accounts, batches: known, byName, ribs, monthlyThreshold: settings.seuil };
}

function toBatchDTO(batch: TransferBatch, statement: TransferBatchDTO["statement"]): TransferBatchDTO {
  const extra = obj(batch.extra);
  return {
    id: batch.id,
    ref: batch.ref,
    fichier: batch.fichier,
    type: batch.type,
    produit: productLabel(batch.type),
    annee: batch.annee,
    mois: batch.mois,
    debit: decimalToNumber(batch.debit),
    credit: decimalToNumber(batch.credit),
    nb: batch.nb,
    status: batch.status,
    verdict: batch.verdict,
    src: String(extra.src ?? ""),
    comment: String(extra.comment ?? ""),
    updatedAt: batch.updatedAt.toISOString(),
    statement,
  };
}

/** Historique des envois de virements d'une année (avec le débit du relevé correspondant). */
export async function listBatches(actor: AuthUser, year: number | null): Promise<ActionResult<{ batches: TransferBatchDTO[]; years: number[]; canEdit: boolean }>> {
  const guard = requireAccess(actor, "VIR");
  if (!guard.success) return guard;
  try {
    const all = await db.transferBatch.findMany({ orderBy: [{ annee: "desc" }, { updatedAt: "desc" }] });
    const years = [...new Set(all.map((batch) => batch.annee).filter((value): value is number => value !== null))].sort((a, b) => b - a);
    const selected = year ? all.filter((batch) => batch.annee === year) : all;
    const debits = selected.map((batch) => batch.debit).filter((debit) => decimalToNumber(debit) > 0);
    const lines = debits.length && can(actor, "RELEVE") ? await db.bankStatementLine.findMany({ where: { sens: "DEBIT", montant: { in: debits } }, select: { montant: true, date: true, status: true } }) : [];
    return ok({
      batches: selected.map((batch) => {
        const match = lines.find((line) => Math.abs(decimalToNumber(line.montant) - decimalToNumber(batch.debit)) < 0.01);
        return toBatchDTO(batch, match ? { date: toIsoDate(match.date) ?? "", status: match.status } : null);
      }),
      years,
      canEdit: can(actor, "VIR", "EDIT"),
    });
  } catch (error) {
    console.error("[virements] historique :", error);
    return fail("L'historique des virements n'a pas pu être chargé.", "DATABASE");
  }
}

/** Détail d'un envoi avec son contrôle complet. */
export async function getBatch(actor: AuthUser, id: string): Promise<ActionResult<{ batch: TransferBatchDTO; analysis: TransferAnalysis; canEdit: boolean; isAdmin: boolean }>> {
  const guard = requireAccess(actor, "VIR");
  if (!guard.success) return guard;
  const batch = await db.transferBatch.findUnique({ where: { id } });
  if (!batch) return fail("Envoi introuvable.", "NOT_FOUND");
  const knowledge = await loadKnowledge();
  const analysis = analyseTransfer(readTransferLines(batch.lines), knowledge, {
    type: batch.type === "A" || batch.type === "B" ? batch.type : "auto",
    mois: batch.mois,
    fileName: batch.fichier,
    selfId: batch.id,
  });
  return ok({ batch: toBatchDTO(batch, null), analysis, canEdit: can(actor, "VIR", "EDIT"), isAdmin: actor.isAdmin });
}

/**
 * Contrôle un fichier de virements déposé : il est lu, analysé et enregistré « en attente »
 * (ou met à jour l'envoi existant du même nom), prêt à être validé ou rejeté.
 */
export async function checkUploadedFile(actor: AuthUser, file: TransferFile, options: UploadCheckOptions): Promise<ActionResult<{ id: string }>> {
  const guard = requireAccess(actor, "VIR", "EDIT");
  if (!guard.success) return guard;
  let sheets;
  try {
    sheets = readWorkbook(file.bytes);
  } catch (error) {
    console.error("[virements] lecture :", error);
    return fail(`Le fichier « ${file.name} » n'a pas pu être lu.`, "VALIDATION");
  }
  const sheet = sheets.map((entry) => ({ entry, detected: detectTransferSheet(entry.rows) })).find((item) => item.detected !== null);
  if (!sheet?.detected) return fail(`Aucun onglet de « ${file.name} » ne contient les colonnes BANQUE / AGENCE / COMPTE / MONTANT / SENS.`, "VALIDATION");
  const lines = extractTransferLines(sheet.entry.rows, sheet.detected);
  const existing = await db.transferBatch.findFirst({ where: { fichier: file.name } });
  const knowledge = await loadKnowledge();
  const analysis = analyseTransfer(lines, knowledge, { type: options.type, mois: options.mois, fileName: file.name, selfId: existing?.id ?? null });
  const ref = file.name.replace(/\.(xlsx|xls|xlsm|csv)$/i, "");
  const data = {
    ref: existing?.ref ?? ref,
    fichier: file.name,
    type: analysis.type,
    annee: options.annee,
    mois: options.mois,
    debit: analysis.debit ?? 0,
    credit: analysis.credit,
    nb: analysis.credits,
    status: existing?.status === "valide" ? "valide" : "attente",
    verdict: analysis.verdict,
    lines: lines.map(storeTransferLine) as Prisma.InputJsonValue,
  };
  const saved = existing
    ? await db.transferBatch.update({ where: { id: existing.id }, data: { ...data, extra: { ...obj(existing.extra), src: "crm", maj: actor.name } as Prisma.InputJsonObject } })
    : await db.transferBatch.create({ data: { ...data, legacyId: `env-${crypto.randomUUID()}`, extra: { src: "crm", cree: actor.name } } });
  await logAction(actor, "Contrôle virement prestataires", `${file.name} – ${analysis.credits} virement(s) – ${formatDA(analysis.credit)}`);
  return ok({ id: saved.id });
}

/** Met à jour le référentiel RIB à la validation d'un envoi : nouveaux prestataires ajoutés, changements de RIB signalés. */
async function updateReferential(actor: AuthUser, batch: TransferBatch, analysis: TransferAnalysis): Promise<{ added: number; changes: number }> {
  let added = 0;
  let changes = 0;
  const seen = new Set<string>();
  for (const line of analysis.lines) {
    if (line.sens !== "C" || !line.ribOk) continue;
    const key = `${line.banque}${line.compte}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const full = `${line.banque}${line.agence}${line.compte}${line.cle.padStart(2, "0")}`;
    const name = `${line.nom} ${line.prenom}`.replace(/\s+/g, " ").trim().toUpperCase();
    const existing = await db.providerRib.findFirst({ where: { key } });
    if (existing) {
      const extra = obj(existing.extra);
      const noms = name && !existing.noms.includes(name) ? [...existing.noms, name] : existing.noms;
      const types = analysis.type && !existing.types.includes(analysis.type) ? [...existing.types, analysis.type] : existing.types;
      let status = existing.status;
      const proposed = obj((extra.propose ?? null) as Prisma.JsonValue);
      if (line.kind === "rib" && existing.rib !== full && proposed.rib !== full) {
        extra.propose = { rib: full, envoi: batch.ref, mois: `${batch.mois} ${batch.annee ?? ""}`.trim(), le: new Date().toISOString(), nom: name, par: actor.id, parNom: actor.name };
        status = "a_valider";
        changes += 1;
      }
      await db.providerRib.update({ where: { id: existing.id }, data: { noms, types, status, rib: existing.rib || full, extra: extra as Prisma.InputJsonObject } });
    } else {
      const change = line.kind === "compte";
      await db.providerRib.create({
        data: {
          legacyId: `r${key}`,
          key,
          rib: full,
          noms: name ? [name] : [],
          types: [analysis.type],
          wilaya: line.adresse.toUpperCase(),
          status: change ? "a_valider" : "actif",
          origine: `envoi ${batch.ref} (${batch.mois} ${batch.annee ?? ""})`.trim(),
          extra: change ? { nouveau: true, change: { type: "compte", autres: line.otherAccounts, envoi: batch.ref, par: actor.id, parNom: actor.name } } : { nouveau: true },
        },
      });
      if (change) changes += 1;
      else added += 1;
    }
  }
  return { added, changes };
}

/** Valide, rejette ou met en attente un envoi. Un envoi bloquant ne peut pas être validé. */
export async function decideBatch(actor: AuthUser, input: DecideBatchInput): Promise<ActionResult<{ added: number; changes: number }>> {
  const guard = requireAccess(actor, "VIR", "EDIT");
  if (!guard.success) return guard;
  const batch = await db.transferBatch.findUnique({ where: { id: input.id } });
  if (!batch) return fail("Envoi introuvable.", "NOT_FOUND");
  const knowledge = await loadKnowledge();
  const analysis = analyseTransfer(readTransferLines(batch.lines), knowledge, {
    type: batch.type === "A" || batch.type === "B" ? batch.type : "auto",
    mois: batch.mois,
    fileName: batch.fichier,
    selfId: batch.id,
  });
  if (input.statut === "valide" && analysis.verdict === "err") return fail("Corrigez les lignes bloquantes avant de valider.", "VALIDATION");
  if (input.statut === "valide" && analysis.overMonthly && !actor.isAdmin) {
    return fail("Un prestataire dépasse le seuil mensuel de double validation : seul un administrateur peut valider cet envoi.", "FORBIDDEN");
  }
  let result = { added: 0, changes: 0 };
  if (input.statut === "valide") result = await updateReferential(actor, batch, analysis);
  await db.transferBatch.update({
    where: { id: batch.id },
    data: { status: input.statut, verdict: analysis.verdict, extra: { ...obj(batch.extra), comment: input.comment, maj: actor.name } as Prisma.InputJsonObject },
  });
  await logAction(
    actor,
    `Envoi virements prestataires ${input.statut === "valide" ? "validé" : input.statut === "rejete" ? "rejeté" : "en attente"}`,
    `${batch.ref} – ${formatDA(decimalToNumber(batch.credit))} – ${batch.nb} virements${result.added ? ` – ${result.added} nouveau(x) RIB` : ""}${result.changes ? ` – ${result.changes} changement(s) de RIB` : ""}`,
  );
  return ok(result);
}

/** Fichier Excel au format de la banque (ligne D puis lignes C). */
export async function batchWorkbook(actor: AuthUser, id: string): Promise<ActionResult<{ name: string; bytes: Uint8Array }>> {
  const guard = requireAccess(actor, "VIR");
  if (!guard.success) return guard;
  const batch = await db.transferBatch.findUnique({ where: { id } });
  if (!batch) return fail("Envoi introuvable.", "NOT_FOUND");
  const lines = readTransferLines(batch.lines);
  const rows: Array<Array<string | number | null>> = [["BANQUE", "AGENCE", "COMPTE", "Clé", "NOM", "PRENOM", "ADRESSE", "MONTANT", "SENS"]];
  for (const line of lines) rows.push([line.banque, line.agence, line.compte, line.cle, line.nom, line.prenom, line.adresse, line.montant, line.sens]);
  const name = /\.xlsx$/i.test(batch.fichier) ? batch.fichier : `${batch.ref || "virements"}.xlsx`;
  return ok({ name, bytes: writeWorkbook([{ name: "Feuil1", rows, widths: [9, 9, 16, 5, 24, 26, 24, 14, 6] }]) });
}

/* ------------------------------------------------------------------ état des virements */

function productOfRequest(produit: string): TransferProduct | null {
  if (produit === TRANSFER_PRODUCTS.B.dpProduct) return "B";
  if (produit === TRANSFER_PRODUCTS.A.dpProduct) return "A";
  return null;
}

function sentRef(extra: Prisma.JsonValue): string | null {
  const value = obj(extra).virEnvoi;
  if (!value) return null;
  if (typeof value === "string") return value;
  const ref = obj(value as Prisma.JsonValue).ref;
  return typeof ref === "string" ? ref : "déjà envoyée";
}

/**
 * Demandes de paiement proposées pour l'état des virements : par virement, produit assistance routière ou BDG.
 * Avec `ids`, la fiche est limitée à ces demandes (par exemple celles qui viennent d'être importées).
 */
export async function sheetRequests(actor: AuthUser, ids: string[] | null): Promise<ActionResult<{ requests: SheetRequest[]; others: number }>> {
  const guard = requireAccess(actor, "VIR");
  if (!guard.success) return guard;
  const rows = await db.paymentRequest.findMany({ where: ids ? { id: { in: ids } } : { archived: false }, orderBy: { num: "desc" } });
  const limit = shiftIsoDate(todayIso(), -30);
  const batches = await db.transferBatch.findMany({ where: { status: { not: "rejete" } }, select: { ref: true, fichier: true, lines: true, updatedAt: true } });
  const requests: SheetRequest[] = [];
  let others = 0;
  for (const row of rows) {
    const product = productOfRequest(row.produit);
    if (!product || row.mode === "CHEQUE" || decimalToNumber(row.montant) <= 0) {
      if (ids) others += 1;
      continue;
    }
    const date = toIsoDate(row.date) ?? row.createdAt.toISOString().slice(0, 10);
    let already = sentRef(row.extra);
    if (!already) {
      for (const batch of batches) {
        if (batch.updatedAt.toISOString().slice(0, 10) < date) continue;
        const lines = readTransferLines(batch.lines).filter((line) => line.sens === "C" && nameSimilarity(`${line.nom} ${line.prenom}`, row.beneficiaire) >= 0.99);
        const total = lines.reduce((sum, line) => sum + line.montant, 0);
        if (lines.length && (lines.some((line) => Math.abs(line.montant - decimalToNumber(row.montant)) < 0.01) || Math.abs(total - decimalToNumber(row.montant)) < 0.01)) {
          already = batch.ref || batch.fichier;
          break;
        }
      }
    }
    requests.push({
      id: row.id,
      ref: row.ref,
      date,
      beneficiaire: row.beneficiaire,
      pieces: row.pieces,
      montant: decimalToNumber(row.montant),
      product,
      alreadySent: already,
      old: date < limit,
      selected: ids !== null && !already,
    });
  }
  return ok({ requests, others });
}

/** Nom et prénom tels qu'ils figurent dans les envois déjà faits pour ce compte. */
function namesFromHistory(key: string, batches: Array<{ lines: Prisma.JsonValue }>): { nom: string; prenom: string } | null {
  let single: string | null = null;
  for (const batch of batches) {
    for (const line of readTransferLines(batch.lines)) {
      if (line.sens !== "C" || `${line.banque}${line.compte}` !== key) continue;
      if (line.nom && line.prenom) return { nom: line.nom, prenom: line.prenom };
      if (line.nom && !single) single = line.nom;
    }
  }
  return single ? splitName(single) : null;
}

/** Calcule les lignes de virement de la fiche (un prestataire par ligne si `grouped`). */
export async function computeSheet(actor: AuthUser, input: SheetInput): Promise<ActionResult<{ lines: SheetLine[]; total: number; transfers: number; problems: number }>> {
  const guard = requireAccess(actor, "VIR");
  if (!guard.success) return guard;
  const [requests, ribs, batches] = await Promise.all([
    db.paymentRequest.findMany({ where: { id: { in: input.requestIds } } }),
    db.providerRib.findMany({ where: { status: { not: "supprime" }, rib: { not: "" } } }),
    db.transferBatch.findMany({ where: { status: { not: "rejete" } }, select: { lines: true } }),
  ]);
  const productCode = input.product;
  const groups = new Map<string, { beneficiaire: string; requests: typeof requests; montant: number }>();
  for (const request of requests) {
    if (productOfRequest(request.produit) !== productCode) continue;
    const key = input.grouped ? upperPlain(request.beneficiaire).trim() : request.id;
    const group = groups.get(key) ?? { beneficiaire: request.beneficiaire.trim(), requests: [], montant: 0 };
    group.requests.push(request);
    group.montant = round2(group.montant + decimalToNumber(request.montant));
    groups.set(key, group);
  }
  const lines: SheetLine[] = [];
  for (const group of groups.values()) {
    const key = `${productCode}|${upperPlain(group.beneficiaire)}`;
    const override = input.overrides[key] ?? {};
    const sameName = ribs.filter((rib) => rib.noms.some((name) => nameSimilarity(name, group.beneficiaire) >= 0.99 && nameSimilarity(group.beneficiaire, name) >= 0.99));
    const preferred = sameName.filter((rib) => rib.types.includes(productCode));
    const candidates = preferred.length ? preferred : sameName;
    const account = override.accountId ? (ribs.find((rib) => rib.id === override.accountId) ?? null) : candidates.length === 1 ? (candidates[0] ?? null) : null;
    const rib = (override.rib ?? "").replace(/\D/g, "") || account?.rib || "";
    const parts = ribParts(rib);
    const known = parts ? (ribs.find((entry) => entry.key === `${parts.banque}${parts.compte}`) ?? account) : account;
    const fromHistory = known ? namesFromHistory(known.key, batches) : null;
    const names = override.nom !== undefined ? { nom: override.nom, prenom: override.prenom ?? "" } : (fromHistory ?? splitName(group.beneficiaire));
    const adresse = override.adresse || known?.wilaya || group.requests.map((request) => request.adresse).find(Boolean) || "";
    let problem: SheetLine["problem"] = "";
    if (!rib && candidates.length > 1) problem = "choix";
    else if (!parts) problem = "rib";
    else if (!ribValid(rib)) problem = "cle";
    else if (!adresse) problem = "adr";
    else if (!names.nom.trim()) problem = "nom";
    let note = "";
    if (parts && !problem) {
      note = BANKS[parts.banque] ?? `Banque ${parts.banque}`;
      if (override.rib && !known) note += " · nouveau prestataire : RIB enregistré à la génération";
      else if (override.rib && account && account.rib !== rib) note += " · changement de RIB : à valider dans le référentiel";
    }
    lines.push({
      key,
      beneficiaire: group.beneficiaire,
      requestIds: group.requests.map((request) => request.id),
      requestRefs: group.requests.map((request) => request.ref),
      montant: group.montant,
      parts: splitAmount(group.montant),
      rib,
      ribSource: override.rib ? "saisi" : account ? "referentiel" : "",
      accountId: account?.id ?? null,
      candidates: candidates.map((entry) => ({ id: entry.id, rib: entry.rib, label: `${entry.rib} · ${entry.noms.join(" / ")}${entry.wilaya ? ` · ${entry.wilaya}` : ""}` })),
      nom: names.nom.toUpperCase(),
      prenom: names.prenom.toUpperCase(),
      adresse: adresse.toUpperCase(),
      bank: parts ? (BANKS[parts.banque] ?? "") : "",
      problem,
      note,
    });
  }
  lines.sort((a, b) => a.beneficiaire.localeCompare(b.beneficiaire, "fr"));
  return ok({
    lines,
    total: round2(lines.reduce((sum, line) => sum + line.montant, 0)),
    transfers: lines.reduce((sum, line) => sum + line.parts.length, 0),
    problems: lines.filter((line) => line.problem !== "").length,
  });
}

async function nextFileName(product: TransferProduct): Promise<string> {
  const prefix = TRANSFER_PRODUCTS[product].file;
  const batches = await db.transferBatch.findMany({ where: { OR: [{ fichier: { startsWith: prefix } }, { ref: { startsWith: prefix } }] }, select: { fichier: true, ref: true } });
  let max = 0;
  const pattern = new RegExp(`^${prefix}_(\\d+)`, "i");
  for (const batch of batches) {
    const match = (batch.fichier || batch.ref).match(pattern);
    if (match?.[1]) max = Math.max(max, Number(match[1]));
  }
  return `${prefix}_${max + 1}`;
}

/**
 * Génère l'état des virements d'un produit : enregistre l'envoi « en attente » (contrôlé),
 * complète le référentiel RIB (nouveaux comptes, changements signalés) et marque les demandes « virement préparé ».
 */
export async function generateSheet(actor: AuthUser, input: SheetInput): Promise<ActionResult<{ batchId: string; name: string }>> {
  const guard = requireAccess(actor, "VIR", "EDIT");
  if (!guard.success) return guard;
  const computed = await computeSheet(actor, input);
  if (!computed.success) return computed;
  const { lines, total } = computed.data;
  if (lines.length === 0) return fail("Aucun virement à générer pour ce produit.", "VALIDATION");
  if (computed.data.problems) return fail("Complétez ou confirmez les lignes signalées (RIB, clé, adresse, nom) avant de générer le fichier.", "VALIDATION");
  try {
    const name = await nextFileName(input.product);
    const stored: TransferLine[] = [{ row: 2, banque: DONOR.banque, agence: DONOR.agence, compte: DONOR.compte, cle: DONOR.cle, nom: DONOR.nom, prenom: DONOR.prenom, adresse: DONOR.adresse, montant: total, sens: "D" }];
    for (const line of lines) {
      const parts = ribParts(line.rib);
      if (!parts) continue;
      for (const amount of line.parts) {
        stored.push({ row: stored.length + 2, banque: parts.banque, agence: parts.agence, compte: parts.compte, cle: parts.cle, nom: line.nom, prenom: line.prenom, adresse: line.adresse, montant: amount, sens: "C" });
      }
    }
    const today = todayIso();
    const knowledge = await loadKnowledge();
    const analysis = analyseTransfer(stored, knowledge, { type: input.product, mois: MONTHS_FR[Number(today.slice(5, 7)) - 1] ?? "", fileName: `${name}.xlsx`, selfId: null });
    const batch = await db.transferBatch.create({
      data: {
        legacyId: `env-${crypto.randomUUID()}`,
        ref: name,
        fichier: `${name}.xlsx`,
        type: input.product,
        annee: Number(today.slice(0, 4)),
        mois: MONTHS_FR[Number(today.slice(5, 7)) - 1] ?? "",
        debit: total,
        credit: total,
        nb: stored.length - 1,
        status: "attente",
        verdict: analysis.verdict,
        lines: stored.map(storeTransferLine) as Prisma.InputJsonValue,
        extra: { src: "crm", cree: actor.name, demandes: lines.flatMap((line) => line.requestIds) },
      },
    });
    for (const line of lines) {
      if (line.ribSource !== "saisi") continue;
      const key = accountKey(line.rib);
      const name2 = `${line.nom} ${line.prenom}`.replace(/\s+/g, " ").trim();
      const existing = await db.providerRib.findFirst({ where: { key } });
      if (existing) {
        await db.providerRib.update({
          where: { id: existing.id },
          data: { noms: existing.noms.includes(name2) ? existing.noms : [...existing.noms, name2], types: existing.types.includes(input.product) ? existing.types : [...existing.types, input.product] },
        });
        continue;
      }
      const previous = line.accountId ? await db.providerRib.findUnique({ where: { id: line.accountId } }) : null;
      if (previous) {
        await db.providerRib.update({
          where: { id: previous.id },
          data: {
            status: "a_valider",
            extra: { ...obj(previous.extra), propose: { rib: line.rib, envoi: name, le: new Date().toISOString(), nom: name2, par: actor.id, parNom: actor.name } } as Prisma.InputJsonObject,
          },
        });
        await logAction(actor, "Changement de RIB signalé", `${name2} : ${previous.rib} → ${line.rib} (${name})`);
        continue;
      }
      await db.providerRib.create({
        data: {
          legacyId: `r${key}`,
          key,
          rib: line.rib,
          noms: [name2],
          types: [input.product],
          wilaya: line.adresse,
          status: actor.isAdmin ? "actif" : "a_valider",
          origine: `saisi pour ${name}`,
          extra: { nouveau: true },
        },
      });
      await logAction(actor, "RIB prestataire saisi", `${name2} – ${line.rib} (${name})`);
    }
    for (const line of lines) {
      for (const requestId of line.requestIds) {
        const request = await db.paymentRequest.findUnique({ where: { id: requestId } });
        if (!request) continue;
        await db.paymentRequest.update({ where: { id: requestId }, data: { extra: { ...obj(request.extra), virEnvoi: { ref: name, le: new Date().toISOString(), par: actor.name } } as Prisma.InputJsonObject } });
      }
    }
    await logAction(actor, "État des virements généré", `${name} – ${TRANSFER_PRODUCTS[input.product].label} – ${stored.length - 1} virement(s) – ${formatDA(total)}`);
    return ok({ batchId: batch.id, name });
  } catch (error) {
    console.error("[virements] génération :", error);
    return fail("L'état des virements n'a pas pu être généré.", "DATABASE");
  }
}
