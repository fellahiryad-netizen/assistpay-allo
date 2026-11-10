import { db } from "@/lib/db";
import { can, requireAccess } from "@/features/access/services/access-rules";
import type { AuthUser } from "@/features/access/types";
import { logAction } from "@/features/journal/services/journal-service";
import { fail, ok, type ActionResult } from "@/types";
import { MONTHS_FR, todayIso } from "@/utils/dates";
import { upperPlain } from "@/utils/text";

import { CAAT_SUCCURSALES } from "@/features/invoices/caat-constants";

export { CAAT_SUCCURSALES };

const AUTO_KEY = "caat-avances-auto";

/** Mois précédent d'une date ISO, au format « AAAA-MM » : les avances sont versées pour le mois écoulé. */
export function previousPeriod(iso: string = todayIso()): string {
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, "0")}`;
}

const legacyIdFor = (period: string, succursale: string): string => `avance-${period}-${upperPlain(succursale).replace(/[^A-Z0-9]/g, "")}`;

/** Crée la ligne d'avance (à 0 DA, en attente) d'une succursale pour un mois « AAAA-MM ». */
async function createAdvance(period: string, succursale: string, index: number, userId: string | null): Promise<string> {
  const [year, month] = period.split("-").map(Number) as [number, number];
  const monthName = MONTHS_FR[month - 1] ?? "";
  const created = await db.invoice.create({
    data: {
      legacyId: legacyIdFor(period, succursale),
      sens: "CREDIT",
      status: "EN_ATTENTE",
      categorie: "CAAT",
      tiers: `CAAT ${succursale}`,
      libelle: `Honoraire Assistance Routière ${monthName} ${year} / CAAT-Succursale-${succursale}`,
      montant: 0,
      annee: year,
      mode: "VIREMENT",
      nature: "Production Assistance",
      classe: 7,
      succursale: `Succursale ${succursale}`,
      periode: period,
      origine: "avance mensuelle",
      ordre: (year * 100 + month) * 100 + index,
      extra: { avance: true },
      createdById: userId,
      updatedById: userId,
    },
  });
  return created.id;
}

/**
 * Retrouve la ligne d'avance CAAT d'une succursale pour un mois, ou la crée si elle n'existe pas encore (règlement d'un ancien mois, par exemple).
 * Renvoie l'identifiant de la facture et son état.
 */
export async function ensureCaatAdvance(actor: AuthUser, period: string, succursale: string): Promise<ActionResult<{ id: string; paid: boolean; created: boolean }>> {
  const guard = requireAccess(actor, "FCLI", "EDIT");
  if (!guard.success) return guard;
  const index = CAAT_SUCCURSALES.findIndex((name) => name === succursale);
  if (index < 0) return fail("Succursale CAAT inconnue.", "VALIDATION");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return fail("Mois invalide.", "VALIDATION");
  try {
    const key = upperPlain(succursale).replace(/[^A-Z0-9]/g, "");
    const rows = await db.invoice.findMany({ where: { sens: "CREDIT", categorie: "CAAT", status: { not: "ANNULE" }, OR: [{ periode: period }, { legacyId: legacyIdFor(period, succursale) }] } });
    const found = rows.find((row) => row.legacyId === legacyIdFor(period, succursale) || upperPlain(`${row.succursale} ${row.tiers}`).replace(/[^A-Z0-9]/g, "").endsWith(key));
    if (found) return ok({ id: found.id, paid: found.status === "REGLE", created: false });
    const id = await createAdvance(period, succursale, index, actor.id);
    await logAction(actor, "Création avance CAAT", `${succursale} – ${MONTHS_FR[Number(period.slice(5, 7)) - 1] ?? ""} ${period.slice(0, 4)} (depuis une affectation du relevé)`);
    return ok({ id, paid: false, created: true });
  } catch (error) {
    console.error("[avances CAAT] ligne introuvable :", error);
    return fail("La ligne d'avance CAAT n'a pas pu être trouvée.", "DATABASE");
  }
}

/** Crée les lignes d'avance manquantes d'un mois (aucun doublon : une ligne par succursale et par mois). */
async function createMissing(period: string, userId: string | null): Promise<{ created: number; existing: number }> {
  const [year, month] = period.split("-").map(Number) as [number, number];
  const monthName = MONTHS_FR[month - 1] ?? "";
  const found = await db.invoice.findMany({
    where: { sens: "CREDIT", categorie: "CAAT", OR: [{ periode: period }, { legacyId: { in: CAAT_SUCCURSALES.map((s) => legacyIdFor(period, s)) } }] },
    select: { periode: true, tiers: true, succursale: true, legacyId: true },
  });
  const taken = new Set(found.flatMap((row) => [row.legacyId, `${row.periode}|${upperPlain(row.succursale || row.tiers).replace(/^(SUCCURSALE|CAAT)\s*/, "").trim()}`]));
  let created = 0;
  for (const [index, succursale] of CAAT_SUCCURSALES.entries()) {
    const key = `${period}|${upperPlain(succursale)}`;
    if (taken.has(legacyIdFor(period, succursale)) || taken.has(key)) continue;
    await createAdvance(period, succursale, index, userId);
    created += 1;
  }
  return { created, existing: CAAT_SUCCURSALES.length - created };
}

/** Crée à la demande les neuf avances CAAT d'un mois (« AAAA-MM »). */
export async function ensureCaatAdvances(actor: AuthUser, period: string): Promise<ActionResult<{ created: number; existing: number }>> {
  const guard = requireAccess(actor, "FCLI", "EDIT");
  if (!guard.success) return guard;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return fail("Mois invalide.", "VALIDATION");
  try {
    const result = await createMissing(period, actor.id);
    if (result.created) await logAction(actor, "Création avances CAAT", `${result.created} ligne(s) d'avance pour ${MONTHS_FR[Number(period.slice(5, 7)) - 1] ?? ""} ${period.slice(0, 4)}`);
    return ok(result);
  } catch (error) {
    console.error("[avances CAAT] création :", error);
    return fail("Les avances n'ont pas pu être créées.", "DATABASE");
  }
}

/**
 * Création automatique : à la première visite d'une personne autorisée après le changement de mois,
 * les avances du mois écoulé sont créées si elles n'existent pas. Ne fait rien si c'est déjà fait ce mois-ci.
 */
export async function autoCaatAdvances(actor: AuthUser): Promise<void> {
  if (!can(actor, "FCLI", "EDIT")) return;
  try {
    const period = previousPeriod();
    const setting = await db.setting.findUnique({ where: { key: AUTO_KEY } });
    const done = setting?.value && typeof setting.value === "object" && !Array.isArray(setting.value) ? (setting.value as Record<string, unknown>).period : null;
    if (done === period) return;
    const result = await createMissing(period, actor.id);
    await db.setting.upsert({ where: { key: AUTO_KEY }, create: { key: AUTO_KEY, value: { period } }, update: { value: { period } } });
    if (result.created) await logAction(actor, "Création automatique avances CAAT", `${result.created} ligne(s) d'avance pour ${MONTHS_FR[Number(period.slice(5, 7)) - 1] ?? ""} ${period.slice(0, 4)}`);
  } catch (error) {
    console.error("[avances CAAT] création automatique :", error);
  }
}

/** Création planifiée (le 1er du mois, sans personne connectée). */
export async function scheduledCaatAdvances(): Promise<{ period: string; created: number }> {
  const period = previousPeriod();
  const result = await createMissing(period, null);
  await db.setting.upsert({ where: { key: AUTO_KEY }, create: { key: AUTO_KEY, value: { period } }, update: { value: { period } } });
  if (result.created) {
    await db.journalEntry.create({ data: { userName: "Automatique", action: "Création automatique avances CAAT", objet: `${result.created} ligne(s) d'avance pour ${MONTHS_FR[Number(period.slice(5, 7)) - 1] ?? ""} ${period.slice(0, 4)}` } });
  }
  return { period, created: result.created };
}
