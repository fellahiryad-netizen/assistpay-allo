import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { requireAccess } from "@/features/access/services/access-rules";
import type { AuthUser } from "@/features/access/types";
import { algiersDay, cancelEnvoiIn, createEnvoiIn, ENVOI_EXPORT_HEADER, envoiKey, envoisToRows, filterEnvois, parseEnvoiYear, parseNumero, sortByNumeroDesc, updateEnvoiIn, type EnvoiChange } from "@/features/courrier/lib/envois";
import type { EnvoiCancelInput, EnvoiCreateInput, EnvoiUpdateInput } from "@/features/courrier/schemas";
import { ENVOI_KEY_PREFIX, type Envoi, type EnvoiFilters, type EnvoiYear } from "@/features/courrier/types";
import { logAction, type JournalTrace } from "@/features/journal/services/journal-service";
import { writeTableWorkbook } from "@/lib/spreadsheet";
import { fail, ok, type ActionResult } from "@/types";
import { todayIso } from "@/utils/dates";

/** Nombre de tentatives d'écriture avant d'abandonner pour cause de modifications simultanées. */
const MAX_ATTEMPTS = 5;

/**
 * Lit, modifie puis écrit une année de bordereaux (clé `courrier:envois:AAAA`) de façon sûre en cas d'accès simultanés :
 * écriture conditionnelle sur `updatedAt` de la ligne, création protégée contre le doublon, nouvelle lecture et nouveau calcul à chaque échec.
 * Le numéro d'ordre étant calculé dans `compute`, sur la version relue, il n'y a ni trou ni doublon.
 */
async function mutateYear<T>(year: number, compute: (doc: EnvoiYear) => EnvoiChange<T>): Promise<ActionResult<T>> {
  const key = envoiKey(year);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const row = await db.setting.findUnique({ where: { key } });
    const change = compute(parseEnvoiYear(row?.value));
    if (!change.ok) return fail(change.error, change.code);
    const value = JSON.parse(JSON.stringify(change.doc)) as Prisma.InputJsonValue;
    const written = row
      ? (await db.setting.updateMany({ where: { key, updatedAt: row.updatedAt }, data: { value } })).count
      : (await db.setting.createMany({ data: [{ key, value }], skipDuplicates: true })).count;
    if (written === 1) return ok(change.value);
  }
  return fail("Les bordereaux ont été modifiés en même temps par quelqu'un d'autre. Réessayez.", "CONFLICT");
}

const values = (item: Envoi | null): JournalTrace["avant"] =>
  item
    ? { numero: item.numero, date: item.date, ramasseur: item.ramasseur, ramasseLe: item.ramasseLe, plis: item.total, lignes: item.lignes.length, remarque: item.remarque, statut: item.statut, motif: item.motifAnnulation }
    : {};

/** Tous les bordereaux de toutes les années, du plus récent au plus ancien. */
async function loadAll(): Promise<Envoi[]> {
  const rows = await db.setting.findMany({ where: { key: { startsWith: ENVOI_KEY_PREFIX } } });
  return sortByNumeroDesc(rows.flatMap((row: { key: string; value: unknown }) => (/^\d{4}$/.test(row.key.slice(ENVOI_KEY_PREFIX.length)) ? parseEnvoiYear(row.value).items : [])));
}

/** Historique des bordereaux (toutes années). Accès Partenaires en consultation. */
export async function listEnvois(actor: AuthUser): Promise<ActionResult<{ envois: Envoi[]; canEdit: boolean }>> {
  const guard = requireAccess(actor, "PART");
  if (!guard.success) return guard;
  try {
    return ok({ envois: await loadAll(), canEdit: requireAccess(actor, "PART", "EDIT").success });
  } catch (error) {
    console.error("[courrier] lecture des bordereaux impossible :", error);
    return fail("L'historique des bordereaux n'a pas pu être lu.", "DATABASE");
  }
}

/** Un bordereau par son numéro (impression, réimpression). Accès Partenaires en consultation. */
export async function getEnvoi(actor: AuthUser, numero: string): Promise<ActionResult<Envoi>> {
  const guard = requireAccess(actor, "PART");
  if (!guard.success) return guard;
  const parts = parseNumero(numero);
  if (!parts) return fail("Numéro de bordereau invalide.", "VALIDATION");
  try {
    const row = await db.setting.findUnique({ where: { key: envoiKey(parts.year) } });
    const found = parseEnvoiYear(row?.value).items.find((item) => item.numero === numero);
    return found ? ok(found) : fail("Ce bordereau n'existe pas.", "NOT_FOUND");
  } catch (error) {
    console.error("[courrier] lecture du bordereau impossible :", error);
    return fail("Le bordereau n'a pas pu être lu.", "DATABASE");
  }
}

/**
 * Enregistre un bordereau et lui attribue le numéro suivant « BE-AAAA-NNN » (année d'Alger). La date et l'heure de création et le créateur sont fixés ici
 * et ne se modifient plus. Accès Partenaires en modification ; écrit dans le journal.
 */
export async function createEnvoi(actor: AuthUser, input: EnvoiCreateInput): Promise<ActionResult<Envoi>> {
  const guard = requireAccess(actor, "PART", "EDIT");
  if (!guard.success) return guard;
  try {
    const now = new Date();
    const annee = Number(algiersDay(now.toISOString()).slice(0, 4));
    const result = await mutateYear(annee, (doc) =>
      createEnvoiIn(doc, { annee, creeLe: now.toISOString(), creePar: actor.name, creeParId: actor.id, date: input.date, ramasseur: input.ramasseur, remarque: input.remarque, lignes: input.lignes }),
    );
    if (!result.success) return result;
    await logAction(actor, "Bordereau d'envoi établi", `${result.data.numero} – ${result.data.total} pli(s), ${result.data.lignes.length} ligne(s)`, false, {
      entity: "courrier-bordereau",
      entityId: result.data.numero,
      avant: {},
      apres: values(result.data),
    });
    return result;
  } catch (error) {
    console.error("[courrier] enregistrement du bordereau impossible :", error);
    return fail("Le bordereau n'a pas pu être enregistré.", "DATABASE");
  }
}

/** Modifie la date de ramassage, le ramasseur ou la remarque d'un bordereau. Accès Partenaires en modification ; écrit dans le journal (avant et après). */
export async function updateEnvoi(actor: AuthUser, input: EnvoiUpdateInput): Promise<ActionResult<Envoi>> {
  const guard = requireAccess(actor, "PART", "EDIT");
  if (!guard.success) return guard;
  const parts = parseNumero(input.numero);
  if (!parts) return fail("Numéro de bordereau invalide.", "VALIDATION");
  try {
    const today = todayIso();
    const result = await mutateYear(parts.year, (doc) => updateEnvoiIn(doc, input.numero, { ramasseLe: input.ramasseLe, ramasseur: input.ramasseur, remarque: input.remarque }, today));
    if (!result.success) return result;
    const { before, after } = result.data;
    await logAction(actor, "Bordereau d'envoi modifié", `${after.numero} – ramassage ${after.ramasseLe || "non renseigné"}`, false, { entity: "courrier-bordereau", entityId: after.numero, avant: values(before), apres: values(after) });
    return ok(after);
  } catch (error) {
    console.error("[courrier] modification du bordereau impossible :", error);
    return fail("Le bordereau n'a pas pu être modifié.", "DATABASE");
  }
}

/** Annule un bordereau (motif obligatoire, conservé et visible ; jamais supprimé). Accès Partenaires en modification ; écrit dans le journal. */
export async function cancelEnvoi(actor: AuthUser, input: EnvoiCancelInput): Promise<ActionResult<Envoi>> {
  const guard = requireAccess(actor, "PART", "EDIT");
  if (!guard.success) return guard;
  const parts = parseNumero(input.numero);
  if (!parts) return fail("Numéro de bordereau invalide.", "VALIDATION");
  try {
    const instant = new Date().toISOString();
    const result = await mutateYear(parts.year, (doc) => cancelEnvoiIn(doc, input.numero, input.motif, actor.name, instant));
    if (!result.success) return result;
    const { before, after } = result.data;
    await logAction(actor, "Bordereau d'envoi annulé", `${after.numero} – motif : ${after.motifAnnulation}`, false, { entity: "courrier-bordereau", entityId: after.numero, avant: values(before), apres: values(after) });
    return ok(after);
  } catch (error) {
    console.error("[courrier] annulation du bordereau impossible :", error);
    return fail("Le bordereau n'a pas pu être annulé.", "DATABASE");
  }
}

/** Excel de l'historique filtré : une ligne par succursale envoyée. Accès Partenaires en consultation et droit d'export. */
export async function exportEnvois(actor: AuthUser, filters: EnvoiFilters): Promise<ActionResult<{ name: string; bytes: Uint8Array }>> {
  const guard = requireAccess(actor, "PART");
  if (!guard.success) return guard;
  const allowed = requireAccess(actor, "A_EXPORT", "EDIT");
  if (!allowed.success) return allowed;
  try {
    const rows = envoisToRows(filterEnvois(await loadAll(), filters));
    const bytes = await writeTableWorkbook([{ name: "Bordereaux", header: [...ENVOI_EXPORT_HEADER], rows, widths: [14, 17, 14, 16, 22, 11, 36, 30, 10, 36, 10, 22] }]);
    return ok({ name: `historique_bordereaux_${todayIso()}.xlsx`, bytes });
  } catch (error) {
    console.error("[courrier] export des bordereaux impossible :", error);
    return fail("L'export n'a pas pu être préparé.", "DATABASE");
  }
}

