import { db } from "@/lib/db";
import { writeWorkbook } from "@/lib/spreadsheet";
import type { HrEntry, Prisma } from "@/generated/prisma/client";
import { can, requireAccess } from "@/features/access/services/access-rules";
import type { AuthUser } from "@/features/access/types";
import type { HrEntryInput, HrQuery } from "@/features/hr/schemas";
import { HR_GROUP_LABELS, hrGroup, type HrEntryDTO, type HrGroup, type HrTotals } from "@/features/hr/types";
import { logAction } from "@/features/journal/services/journal-service";
import { fail, ok, type ActionResult } from "@/types";
import { round2 } from "@/utils/amounts";
import { MONTHS_FR, fromIsoDate, toIsoDate, todayIso } from "@/utils/dates";
import { formatDA } from "@/utils/format";

function obj(value: Prisma.JsonValue): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

const yearOf = (row: HrEntry): number => row.annee ?? (Number((row.mois || toIsoDate(row.date) || "").slice(0, 4)) || 0);

/** Mois de rattachement (repris de l'ancienne version) : mois de la date si elle est dans l'année, sinon le mois saisi. */
function monthKey(row: HrEntry): string {
  const year = String(yearOf(row));
  const date = toIsoDate(row.date) ?? "";
  if (date.slice(0, 4) === year) return date.slice(0, 7);
  return row.mois.slice(0, 4) === year ? row.mois : "";
}

const signed = (row: HrEntry): number => (row.sens === "RETOUR" ? -1 : 1) * Number(row.montant);

function toDTO(row: HrEntry): HrEntryDTO {
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
  };
}

const emptyTotals = (): HrTotals => ({ sal: 0, cnas: 0, g50: 0, autre: 0 });

/** Écran RH : saisies filtrées, totaux de l'année et synthèse mensuelle. Confidentiel (accès RH). */
export async function listHr(
  actor: AuthUser,
  query: HrQuery,
): Promise<ActionResult<{ entries: HrEntryDTO[]; totalCount: number; totalAmount: number; years: number[]; year: number | "all"; totals: HrTotals; months: Array<{ key: string; totals: HrTotals }>; natures: string[]; beneficiaries: string[]; canEdit: boolean }>> {
  const guard = requireAccess(actor, "RH");
  if (!guard.success) return guard;
  const rows = await db.hrEntry.findMany({ orderBy: [{ date: "desc" }, { ordre: "desc" }] });
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
  const filtered = inYear.filter((row) => (!query.nature || row.nature === query.nature) && (!query.mois || monthKey(row) === query.mois) && (!q || [row.beneficiaire, row.libelle, row.nature, row.cheque].join(" ").toLowerCase().includes(q)));
  return ok({
    entries: filtered.slice(0, 400).map(toDTO),
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
  const groups = new Map<string, { annee: number; mk: string; credit: boolean; classe: number | null; montant: number; date: string }>();
  for (const row of rows) {
    const annee = yearOf(row);
    const mk = monthKey(row);
    const credit = row.sens === "RETOUR";
    const id = `rhagg-${annee}-${mk ? mk.slice(5) : "nd"}-${credit ? "c" : "d"}-${row.classe ?? "x"}`;
    const group = groups.get(id) ?? { annee, mk, credit, classe: row.classe, montant: 0, date: "" };
    group.montant = round2(group.montant + Number(row.montant));
    const date = toIsoDate(row.date) ?? "";
    if (date.slice(0, 4) === String(annee) && date > group.date) group.date = date;
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
        dateOperation: fromIsoDate(group.date || null),
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
  const guard = requireAccess(actor, "RH", "EDIT");
  if (!guard.success) return guard;
  const stamp = { le: new Date().toISOString(), nom: actor.name, par: actor.id };
  const data = {
    nature: input.nature,
    sens: input.sens,
    beneficiaire: input.beneficiaire,
    mois: input.mois,
    date: fromIsoDate(input.date || null),
    annee: Number((input.date || input.mois).slice(0, 4)),
    montant: input.montant,
    mode: input.mode,
    cheque: input.mode === "CHEQUE" ? input.cheque : "",
    banque: input.banque,
    libelle: input.libelle,
  };
  let id: string;
  if (input.id) {
    const current = await db.hrEntry.findUnique({ where: { id: input.id } });
    if (!current) return fail("Saisie introuvable.", "NOT_FOUND");
    await db.hrEntry.update({ where: { id: input.id }, data: { ...data, extra: { ...obj(current.extra), maj: stamp } as Prisma.InputJsonObject } });
    id = input.id;
  } else {
    const created = await db.hrEntry.create({ data: { ...data, legacyId: `rh-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, classe: 6, ordre: Date.now(), origine: "saisie", extra: { cree: stamp, maj: stamp } } });
    id = created.id;
  }
  await syncHrAggregates();
  await logAction(actor, input.id ? "Modification saisie RH" : "Saisie RH", `${input.nature} – ${input.beneficiaire} – ${formatDA(input.montant)}`);
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
