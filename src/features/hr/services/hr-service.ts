import { aggregateDate, monthKeyOfEntry, storedYear, yearOfEntry } from "@/features/hr/lib/hr-period";
import { db } from "@/lib/db";
import { writeWorkbook } from "@/lib/spreadsheet";
import type { HrEntry, Prisma } from "@/generated/prisma/client";
import { can, requireAccess, requireAdmin } from "@/features/access/services/access-rules";
import type { AuthUser } from "@/features/access/types";
import type { HrAnomaliesValidateInput, HrEntryInput, HrQuery } from "@/features/hr/schemas";
import { normalizeText } from "@/utils/text";
import { HR_GROUP_LABELS, hrGroup, type HrAnomalyDTO, type HrBankInfo, type HrValidatedAnomalyDTO, type HrEntryDTO, type HrGroup, type HrTotals } from "@/features/hr/types";
import { detectHrAnomalies, mergeValidations, parseValidations, partitionAnomalies, removeValidation, type HrAnomaly, type HrAnomalyValidation, type HrValidationUpdate } from "@/features/hr/lib/hr-anomalies";
import { isBankEntry, matchHrToBank, type HrBankEntry, type HrBankLine, type HrBankMatch } from "@/features/hr/lib/hr-bank-match";
import { describeHrEntry, duplicateMessage, evaluateDuplicate, type HrDuplicate, type HrEntryLike } from "@/features/hr/lib/hr-duplicates";
import { logAction } from "@/features/journal/services/journal-service";
import { fail, ok, type ActionResult, type ErrorCode } from "@/types";
import { round2 } from "@/utils/amounts";
import { MONTHS_FR, fromIsoDate, shiftIsoDate, toIsoDate, todayIso } from "@/utils/dates";
import { formatDA } from "@/utils/format";

function obj(value: Prisma.JsonValue): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

const periodFields = (row: HrEntry): { nature: string; mois: string; annee: number | null; date: string | null } => ({ nature: row.nature, mois: row.mois, annee: row.annee, date: toIsoDate(row.date) });

/** Année de rattachement (voir `yearOfEntry`). */
const yearOf = (row: HrEntry): number => yearOfEntry(periodFields(row));

/** Mois de rattachement (voir `monthKeyOfEntry`) : G50, IRG, IBS dans le mois de la période couverte, les autres natures selon la date de paiement. */
const monthKey = (row: HrEntry): string => monthKeyOfEntry(periodFields(row));

const signed = (row: HrEntry): number => (row.sens === "RETOUR" ? -1 : 1) * Number(row.montant);

const NO_BANK: HrBankInfo = { status: "na", date: null, libelle: "", detail: "" };

function toDTO(row: HrEntry, releve: HrBankInfo = NO_BANK): HrEntryDTO {
  const extra = obj(row.extra);
  const maj = obj((extra.maj ?? extra.cree ?? null) as Prisma.JsonValue);
  return {
    id: row.id,
    date: toIsoDate(row.date),
    mois: row.mois,
    annee: yearOf(row),
    monthKey: monthKey(row),
    nature: row.nature,
    beneficiaire: row.beneficiaire,
    libelle: row.libelle,
    montant: Number(row.montant),
    sens: row.sens,
    mode: row.mode,
    cheque: row.cheque,
    banque: row.banque,
    par: String(maj.nom ?? maj.label ?? ""),
    releve,
  };
}

function toLike(row: HrEntry): HrEntryLike {
  return { id: row.id, nature: row.nature, sens: row.sens, beneficiaire: row.beneficiaire, mois: row.mois, date: toIsoDate(row.date), montant: Number(row.montant), cheque: row.cheque, libelle: row.libelle };
}

/**
 * Garde-fou anti-doublon (règles dans `evaluateDuplicate`). Refus CONFLICT ; renvoie le doublon probable confirmé, le cas échéant.
 */
async function checkHrDuplicate(candidate: HrEntryLike, options: { confirm: boolean; canConfirm?: boolean; previous?: HrEntry }): Promise<ActionResult<{ confirmed: HrDuplicate | null }>> {
  const rows = await db.hrEntry.findMany({ where: { montant: round2(candidate.montant) } });
  const decision = evaluateDuplicate(candidate, options.previous ? toLike(options.previous) : undefined, rows.map(toLike), options.confirm);
  if (!decision.allowed) return fail(duplicateMessage(decision.duplicate, options.canConfirm ?? true), "CONFLICT");
  return ok({ confirmed: decision.confirmed });
}

/** Lignes DEBIT du relevé proches des dates des écritures (lecture seule). */
async function loadBankLines(rows: HrEntry[]): Promise<HrBankLine[]> {
  const dates = rows.map((row) => toIsoDate(row.date)).filter((value): value is string => Boolean(value)).sort();
  const first = dates[0];
  const last = dates[dates.length - 1];
  if (!first || !last) return [];
  const lines = await db.bankStatementLine.findMany({
    where: { sens: "DEBIT", date: { gte: fromIsoDate(shiftIsoDate(first, -95)) ?? undefined, lte: fromIsoDate(shiftIsoDate(last, 95)) ?? undefined } },
    select: { id: true, date: true, libelle: true, numero: true, montant: true, sens: true, invoiceRefs: true },
  });
  return lines.map((line) => ({ id: line.id, date: toIsoDate(line.date) ?? "", libelle: line.libelle, numero: line.numero, montant: Number(line.montant), sens: line.sens, refs: line.invoiceRefs }));
}

function toBankEntry(row: HrEntry): HrBankEntry {
  return { id: row.id, legacyId: row.legacyId, sens: row.sens, mode: row.mode, cheque: row.cheque, montant: Number(row.montant), date: toIsoDate(row.date) };
}

function bankInfoOf(row: HrEntry, match: HrBankMatch | undefined, lines: Map<string, HrBankLine>, showBank: boolean): HrBankInfo {
  if (!isBankEntry(toBankEntry(row))) return NO_BANK;
  const line = match ? lines.get(match.lineId) : undefined;
  if (!match || !line) return { status: "non_trouve", date: null, libelle: "", detail: "" };
  return {
    status: match.level === "fort" ? "rapproche" : "probable",
    date: showBank ? line.date : null,
    libelle: showBank ? line.libelle : "",
    detail: match.level === "faible" ? "montant seul" : match.level === "moyen" ? "montant et date" : "",
  };
}

const VALIDATIONS_KEY = "hr:anomalies:validees";

/** Ordre unique de chargement des écritures (départage par identifiant) : mêmes listes, mêmes messages, mêmes clés partout. */
const HR_ORDER = [{ date: "desc" }, { ordre: "desc" }, { id: "asc" }] as const;

async function loadValidations(): Promise<HrAnomalyValidation[]> {
  const row = await db.setting.findUnique({ where: { key: VALIDATIONS_KEY } });
  return parseValidations(row?.value);
}

/**
 * Lecture, modification et écriture du réglage des validations, sûres en concurrence : écriture conditionnelle sur `updatedAt`
 * de la ligne (même principe que `guardedUpdate` des factures), avec jusqu'à 5 tentatives. `compute` reçoit la liste lue et renvoie la nouvelle liste ou un refus.
 */
async function updateValidations(compute: (items: HrAnomalyValidation[]) => HrValidationUpdate | { ok: false; error: string; code: ErrorCode }): Promise<ActionResult<true>> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const row = await db.setting.findUnique({ where: { key: VALIDATIONS_KEY } });
    const next = compute(parseValidations(row?.value));
    if (!next.ok) return fail(next.error, "code" in next ? next.code : "CONFLICT");
    const value = JSON.parse(JSON.stringify({ items: next.items })) as Prisma.InputJsonValue;
    const written = row
      ? (await db.setting.updateMany({ where: { key: VALIDATIONS_KEY, updatedAt: row.updatedAt }, data: { value } })).count
      : (await db.setting.createMany({ data: [{ key: VALIDATIONS_KEY, value }], skipDuplicates: true })).count;
    if (written === 1) return ok(true);
  }
  return fail("Les anomalies validées ont été modifiées en même temps par quelqu'un d'autre. Réessayez.", "CONFLICT");
}

const anomalyEntries = (rows: HrEntry[]): Parameters<typeof detectHrAnomalies>[0] => rows.map((row) => ({ ...toLike(row), id: row.id, monthKey: monthKey(row) }));

/** Anomalies de toutes les écritures, toutes années (référence pour valider, rétablir et purger). */
async function currentAnomalies(): Promise<HrAnomaly[]> {
  return detectHrAnomalies(anomalyEntries(await db.hrEntry.findMany({ orderBy: [...HR_ORDER] })));
}

/**
 * Valide des anomalies (« j'ai vérifié, c'est normal ») : elles sortent du compteur et de la liste tant que les écritures concernées ne changent pas.
 * Un seul motif, une seule écriture du réglage et une seule ligne de journal, même pour plusieurs anomalies. Les clés qui n'existent plus sont ignorées.
 * Les validations dont l'anomalie a disparu sont purgées ; au-delà de 500, la validation est refusée. Accès RH en modification.
 */
export async function validateHrAnomalies(actor: AuthUser, input: HrAnomaliesValidateInput): Promise<ActionResult<{ done: number }>> {
  const guard = requireAccess(actor, "RH", "EDIT");
  if (!guard.success) return guard;
  const anomalies = await currentAnomalies();
  const byKey = new Map(anomalies.map((item) => [item.key, item]));
  const found = [...new Set(input.keys)].map((key) => byKey.get(key)).filter((item): item is HrAnomaly => item !== undefined);
  if (found.length === 0) return fail("Cette anomalie n'existe plus (une écriture a été modifiée ou supprimée). Rechargez la page.", "NOT_FOUND");
  const le = new Date().toISOString();
  const added = found.map((item) => ({ key: item.key, motif: input.motif, par: actor.name, parId: actor.id, le }));
  const saved = await updateValidations((items) => mergeValidations(items, added, [...byKey.keys()]));
  if (!saved.success) return saved;
  const suffix = input.motif ? ` – motif : ${input.motif}` : "";
  const [only] = found;
  await logAction(actor, found.length === 1 && only ? "Anomalie RH validée" : "Anomalies RH validées", found.length === 1 && only ? `${only.message}${suffix}` : `${found.length} anomalie(s)${suffix}`);
  return ok({ done: found.length });
}

/** Rétablit une anomalie validée : elle réapparaît dans la liste à traiter (les validations orphelines sont purgées au passage). Accès RH en modification. */
export async function restoreHrAnomaly(actor: AuthUser, input: { key: string }): Promise<ActionResult<{ key: string }>> {
  const guard = requireAccess(actor, "RH", "EDIT");
  if (!guard.success) return guard;
  const anomalies = await currentAnomalies();
  const saved = await updateValidations((items) => (items.some((item) => item.key === input.key) ? removeValidation(items, input.key, anomalies.map((item) => item.key)) : { ok: false, error: "Cette anomalie n'est pas dans les anomalies validées.", code: "NOT_FOUND" }));
  if (!saved.success) return saved;
  await logAction(actor, "Anomalie RH rétablie", anomalies.find((item) => item.key === input.key)?.message ?? input.key);
  return ok({ key: input.key });
}

const emptyTotals = (): HrTotals => ({ sal: 0, cnas: 0, g50: 0, autre: 0 });

/** Écran RH : saisies filtrées, totaux de l'année et synthèse mensuelle. Confidentiel (accès RH). */
export async function listHr(
  actor: AuthUser,
  query: HrQuery,
): Promise<ActionResult<{ entries: HrEntryDTO[]; totalCount: number; totalAmount: number; years: number[]; year: number | "all"; totals: HrTotals; months: Array<{ key: string; totals: HrTotals }>; natures: string[]; beneficiaries: string[]; canEdit: boolean; anomalies: HrAnomalyDTO[]; anomalyCount: number; validatedAnomalies: HrValidatedAnomalyDTO[]; anomalyEntries: Record<string, HrEntryDTO>; openKeysByKind: Record<HrAnomaly["kind"], string[]>; notFoundCount: number; probableCount: number }>> {
  const guard = requireAccess(actor, "RH");
  if (!guard.success) return guard;
  const rows = await db.hrEntry.findMany({ orderBy: [...HR_ORDER] });
  const years = [...new Set(rows.map(yearOf).filter(Boolean))].sort((a, b) => b - a);
  const current = Number(todayIso().slice(0, 4));
  const year: number | "all" = query.annee ?? (years.includes(current) ? current : (years.find((value) => value <= current) ?? years[0] ?? current));
  const inYear = rows.filter((row) => year === "all" || yearOf(row) === year);
  const totals = emptyTotals();
  const byMonth = new Map<string, HrTotals>();
  for (const row of inYear) {
    const group = hrGroup(row.nature);
    totals[group] = round2(totals[group] + signed(row));
    const key = monthKey(row);
    const month = byMonth.get(key) ?? emptyTotals();
    month[group] = round2(month[group] + signed(row));
    byMonth.set(key, month);
  }
  const q = (query.q ?? "").toLowerCase();
  // Rapprochement avec le relevé et anomalies : lecture seule, sur toute l'année affichée (pas seulement la page).
  const bankLines = await loadBankLines(inYear);
  const lineById = new Map(bankLines.map((line) => [line.id, line]));
  const matches = matchHrToBank(inYear.map(toBankEntry), bankLines);
  const showBank = can(actor, "RELEVE");
  const bankInfo = new Map<string, HrBankInfo>(inYear.map((row): [string, HrBankInfo] => [row.id, bankInfoOf(row, matches.get(row.id), lineById, showBank)]));
  const unmatched = (row: HrEntry): boolean => {
    const status = bankInfo.get(row.id)?.status;
    return status === "non_trouve" || status === "probable";
  };
  const { open: anomalies, validated } = partitionAnomalies(detectHrAnomalies(anomalyEntries(inYear)), await loadValidations());
  const shownAnomalies = query.anomalies === "tout" ? anomalies : anomalies.slice(0, 60);
  const shownIds = new Set(shownAnomalies.flatMap((item) => item.entryIds));
  const anomalyDto = (anomaly: HrAnomaly): HrAnomalyDTO => ({ key: anomaly.key, kind: anomaly.kind, level: anomaly.level, message: anomaly.message, entryIds: anomaly.entryIds });
  const filtered = inYear.filter(
    (row) =>
      (!query.nature || row.nature === query.nature) &&
      (!query.mois || monthKey(row) === query.mois) &&
      (!query.releve || unmatched(row)) &&
      (!q || [row.beneficiaire, row.libelle, row.nature, row.cheque].join(" ").toLowerCase().includes(q)),
  );
  return ok({
    entries: filtered.slice(0, 400).map((row) => toDTO(row, bankInfo.get(row.id))),
    anomalies: shownAnomalies.map(anomalyDto),
    anomalyEntries: Object.fromEntries(inYear.filter((row) => shownIds.has(row.id)).map((row) => [row.id, toDTO(row, bankInfo.get(row.id))])),
    anomalyCount: anomalies.length,
    openKeysByKind: { doublon: anomalies.filter((item) => item.kind === "doublon").map((item) => item.key), beneficiaire: anomalies.filter((item) => item.kind === "beneficiaire").map((item) => item.key), periode: anomalies.filter((item) => item.kind === "periode").map((item) => item.key) },
    validatedAnomalies: validated.map(({ anomaly, validation }) => ({ key: anomaly.key, kind: anomaly.kind, message: anomaly.message, motif: validation.motif, par: validation.par, le: validation.le })),
    notFoundCount: inYear.filter((row) => bankInfo.get(row.id)?.status === "non_trouve").length,
    probableCount: inYear.filter((row) => bankInfo.get(row.id)?.status === "probable").length,
    totalCount: filtered.length,
    totalAmount: round2(filtered.reduce((sum, row) => sum + signed(row), 0)),
    years,
    year,
    totals,
    months: [...byMonth.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([key, value]) => ({ key, totals: value })),
    natures: [...new Set(rows.map((row) => row.nature))].sort(),
    beneficiaries: [...new Set(rows.map((row) => row.beneficiaire).filter(Boolean))].sort(),
    canEdit: can(actor, "RH", "EDIT"),
  });
}

/**
 * Recalcule les totaux mensuels « Charges de personnel (agrégé) » reportés dans les factures (lignes de paie),
 * comme l'ancienne version : une ligne par année, mois, sens et classe.
 */
export async function syncHrAggregates(): Promise<void> {
  const rows = await db.hrEntry.findMany();
  const groups = new Map<string, { annee: number; mk: string; credit: boolean; classe: number | null; montant: number; dates: string[] }>();
  for (const row of rows) {
    const annee = yearOf(row);
    const mk = monthKey(row);
    const credit = row.sens === "RETOUR";
    const id = `rhagg-${annee}-${mk ? mk.slice(5) : "nd"}-${credit ? "c" : "d"}-${row.classe ?? "x"}`;
    const group = groups.get(id) ?? { annee, mk, credit, classe: row.classe, montant: 0, dates: [] as string[] };
    group.montant = round2(group.montant + Number(row.montant));
    const date = toIsoDate(row.date);
    if (date) group.dates.push(date);
    groups.set(id, group);
  }
  const existing = await db.invoice.findMany({ where: { legacyId: { startsWith: "rhagg-" } }, select: { id: true, legacyId: true } });
  await db.$transaction(async (tx) => {
    for (const [legacyId, group] of groups) {
      const libelle = `Total charges de personnel ${group.mk ? `${(MONTHS_FR[Number(group.mk.slice(5)) - 1] ?? "").toLowerCase()} ${group.annee}` : `${group.annee} (date non renseignée)`}${group.credit ? " – retours" : ""} – détail dans l'onglet RH`;
      const data = {
        sens: group.credit ? ("CREDIT" as const) : ("DEBIT" as const),
        status: "REGLE" as const,
        categorie: "Charges de personnel (agrégé)",
        tiers: "Charges de personnel",
        libelle,
        montant: group.montant,
        dateOperation: fromIsoDate(aggregateDate(group.mk, group.annee, group.dates) || null),
        annee: group.annee,
        nature: group.classe === 6 ? "Charge" : "",
        classe: group.classe,
        payroll: true,
        origine: "rh",
      };
      await tx.invoice.upsert({ where: { legacyId }, create: { legacyId, ...data }, update: data });
    }
    const stale = existing.filter((row) => !groups.has(row.legacyId)).map((row) => row.id);
    if (stale.length) await tx.invoice.deleteMany({ where: { id: { in: stale } } });
  });
}

/** Création ou modification d'une écriture RH ; les totaux mensuels du suivi sont mis à jour. */
export async function saveHrEntry(actor: AuthUser, input: HrEntryInput): Promise<ActionResult<{ id: string }>> {
  return persistHrEntry(actor, input, true);
}

async function persistHrEntry(actor: AuthUser, input: HrEntryInput, canConfirm: boolean): Promise<ActionResult<{ id: string }>> {
  const guard = requireAccess(actor, "RH", "EDIT");
  if (!guard.success) return guard;
  const stamp = { le: new Date().toISOString(), nom: actor.name, par: actor.id };
  const data = {
    nature: input.nature,
    sens: input.sens,
    beneficiaire: input.beneficiaire,
    mois: input.mois,
    date: fromIsoDate(input.date || null),
    annee: storedYear(input.nature, input.mois, input.date || null),
    montant: input.montant,
    mode: input.mode,
    cheque: input.mode === "CHEQUE" ? input.cheque : "",
    banque: input.banque,
    libelle: input.libelle,
  };
  let id: string;
  const current = input.id ? await db.hrEntry.findUnique({ where: { id: input.id } }) : null;
  if (input.id && !current) return fail("Saisie introuvable.", "NOT_FOUND");
  const duplicate = await checkHrDuplicate(
    { id: input.id, nature: input.nature, sens: input.sens, beneficiaire: input.beneficiaire, mois: input.mois, date: input.date || null, montant: input.montant, cheque: data.cheque, libelle: input.libelle },
    { confirm: input.confirmerDoublon, canConfirm, previous: current ?? undefined },
  );
  if (!duplicate.success) return duplicate;
  const confirmed = duplicate.data.confirmed;
  if (input.id && current) {
    await db.hrEntry.update({ where: { id: input.id }, data: { ...data, extra: { ...obj(current.extra), maj: stamp } as Prisma.InputJsonObject } });
    id = input.id;
  } else {
    const created = await db.hrEntry.create({ data: { ...data, legacyId: `rh-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, classe: 6, ordre: Date.now(), origine: "saisie", extra: { cree: stamp, maj: stamp } } });
    id = created.id;
  }
  await syncHrAggregates();
  await logAction(actor, input.id ? "Modification saisie RH" : "Saisie RH", `${input.nature} – ${input.beneficiaire} – ${formatDA(input.montant)}${confirmed ? ` – doublon probable confirmé (écriture voisine : ${describeHrEntry(confirmed.entry)})` : ""}`);
  return ok({ id });
}

/** Suppression d'une écriture RH. */
export async function deleteHrEntry(actor: AuthUser, input: { id: string }): Promise<ActionResult<{ id: string }>> {
  const guard = requireAccess(actor, "RH", "EDIT");
  if (!guard.success) return guard;
  const current = await db.hrEntry.findUnique({ where: { id: input.id } });
  if (!current) return fail("Saisie introuvable.", "NOT_FOUND");
  await db.hrEntry.delete({ where: { id: input.id } });
  await syncHrAggregates();
  await logAction(actor, "Suppression saisie RH", `${current.nature} – ${current.beneficiaire} – ${formatDA(Number(current.montant))}`);
  return ok({ id: input.id });
}

/** Export Excel confidentiel des saisies filtrées. */
export async function exportHr(actor: AuthUser, query: HrQuery): Promise<ActionResult<{ name: string; bytes: Uint8Array }>> {
  const result = await listHr(actor, query);
  if (!result.success) return result;
  const rows = await db.hrEntry.findMany({ orderBy: [{ date: "asc" }, { ordre: "asc" }] });
  const q = (query.q ?? "").toLowerCase();
  const year = result.data.year;
  const list = rows.filter((row) => (year === "all" || yearOf(row) === year) && (!query.nature || row.nature === query.nature) && (!query.mois || monthKey(row) === query.mois) && (!q || [row.beneficiaire, row.libelle, row.nature, row.cheque].join(" ").toLowerCase().includes(q)));
  const header = ["Année", "Mois", "Date de paiement", "Nature", "Groupe", "Employé / organisme", "Libellé", "Type", "Montant", "Mode", "N° chèque", "Banque"];
  const body = list.map((row) => [yearOf(row), row.mois, toIsoDate(row.date) ?? "", row.nature, HR_GROUP_LABELS[hrGroup(row.nature) as HrGroup], row.beneficiaire, row.libelle, row.sens === "RETOUR" ? "Retour / remboursement" : "Paiement", signed(row), row.mode === "CHEQUE" ? "Chèque" : row.mode === "VIRMT" ? "Virement" : "", row.cheque, row.banque]);
  await logAction(actor, "Export RH", `${list.length} saisie(s)`);
  return ok({ name: `RH_confidentiel_${year === "all" ? "toutes_annees" : year}_${todayIso()}.xlsx`, bytes: writeWorkbook([{ name: "RH", rows: [header, ...body], widths: [6, 9, 12, 20, 18, 28, 36, 18, 14, 10, 12, 12] }]) });
}

/** Nature RH déduite du texte d'une facture de paie. */
export function hrNatureOf(text: string): string {
  const t = ` ${normalizeText(text).toUpperCase()} `;
  if (/CASNOS/.test(t)) return "CASNOS";
  if (/CNAS/.test(t)) return "CNAS";
  if (/[^A-Z0-9]G50[^A-Z0-9]/.test(t)) return "G50";
  if (/[^A-Z0-9]IRG[^A-Z0-9]/.test(t)) return "IRG";
  if (/[^A-Z0-9]IBS[^A-Z0-9]/.test(t)) return "IBS";
  if (/MISSION/.test(t)) return "Frais de mission";
  if (/AVANCE/.test(t)) return "Avance sur salaire";
  if (/SALAIRE/.test(t)) return "Salaire";
  return "Autre charge de personnel";
}

/**
 * Transfère vers l'onglet RH des factures de paie (G50, IRG, CNAS, salaires…) restées dans le suivi des factures.
 * Réservé aux administrateurs. La ligne RH reprend date, montant, mode, chèque et banque ; la facture d'origine
 * est supprimée (le total mensuel agrégé du suivi la remplace). Les factures non réglées ou liées à une demande
 * de paiement sont refusées.
 */
export async function transferInvoicesToHr(actor: AuthUser, ids: string[]): Promise<ActionResult<{ done: number; failures: string[] }>> {
  const guard = requireAdmin(actor);
  if (!guard.success) return guard;
  const failures: string[] = [];
  let done = 0;
  try {
    const rows = await db.invoice.findMany({ where: { id: { in: ids } } });
    for (const row of rows) {
      const label = `${row.tiers} ${row.numero}`.trim();
      if (row.origine === "rh") {
        failures.push(`${label} : ligne déjà agrégée depuis l'onglet RH`);
        continue;
      }
      if (row.status !== "REGLE") {
        failures.push(`${label} : à transférer une fois réglée (l'onglet RH enregistre des paiements)`);
        continue;
      }
      if (row.paymentRefs.length > 0) {
        failures.push(`${label} : liée à une demande de paiement`);
        continue;
      }
      const date = row.dateOperation ?? row.dateFacture;
      const iso = toIsoDate(date) ?? "";
      const nature = hrNatureOf(`${row.categorie} ${row.tiers} ${row.libelle} ${row.nature}`);
      const duplicate = await checkHrDuplicate(
        { nature, sens: row.sens === "CREDIT" ? "RETOUR" : "PAIEMENT", beneficiaire: row.tiers, mois: iso.slice(0, 7), date: iso || null, montant: Number(row.montant), cheque: row.cheque, libelle: row.libelle },
        { confirm: false, canConfirm: false },
      );
      if (!duplicate.success) {
        failures.push(`${label} : ${duplicate.error} La facture n'a pas été transférée.`);
        continue;
      }
      await db.hrEntry.create({
        data: {
          legacyId: `rh-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
          date,
          annee: iso ? Number(iso.slice(0, 4)) : row.annee,
          mois: iso.slice(0, 7),
          beneficiaire: row.tiers,
          libelle: row.libelle,
          montant: row.montant,
          sens: row.sens === "CREDIT" ? "RETOUR" : "PAIEMENT",
          nature,
          mode: row.mode ?? "",
          banque: row.banque,
          cheque: row.cheque,
          classe: 6,
          ordre: Date.now(),
          origine: "transfert facture",
          categorieOrigine: row.categorie,
          extra: { cree: { le: new Date().toISOString(), nom: actor.name, par: actor.id }, factureLegacyId: row.legacyId, numero: row.numero },
        },
      });
      await db.invoice.delete({ where: { id: row.id } });
      await logAction(actor, "Transfert vers RH", `${nature} – ${row.tiers} – ${formatDA(Number(row.montant))}`);
      done += 1;
    }
    if (done > 0) await syncHrAggregates();
    return ok({ done, failures });
  } catch (error) {
    console.error("[rh] transfert impossible :", error);
    return fail("Le transfert vers RH n'a pas pu être terminé.", "DATABASE");
  }
}

/**
 * Une facture saisie avec une nature de paie (salaire, CNAS, G50, IRG, frais de mission…) devient directement
 * une écriture de l'onglet RH. Nécessite l'accès RH en modification.
 */
export async function recordPayrollInHr(
  actor: AuthUser,
  input: { sens: "CREDIT" | "DEBIT"; categorie: string; tiers: string; libelle: string; nature: string; montant: number; dateFacture: string | null; dateOperation: string | null; mode: string | null; cheque: string; banque: string },
): Promise<ActionResult<{ id: string }>> {
  const date = input.dateOperation ?? input.dateFacture ?? todayIso();
  return persistHrEntry(actor, {
    nature: hrNatureOf(`${input.categorie} ${input.tiers} ${input.libelle} ${input.nature}`) as HrEntryInput["nature"],
    sens: input.sens === "CREDIT" ? "RETOUR" : "PAIEMENT",
    beneficiaire: input.tiers || input.categorie,
    mois: date.slice(0, 7),
    date,
    montant: input.montant,
    mode: input.mode === "CHEQUE" ? "CHEQUE" : input.mode === "VIREMENT" ? "VIRMT" : "",
    cheque: input.mode === "CHEQUE" ? input.cheque : "",
    banque: input.banque,
    libelle: input.libelle,
    confirmerDoublon: false,
  }, false);
}
