import { db } from "@/lib/db";
import { readWorkbook } from "@/lib/spreadsheet";
import type { Prisma } from "@/generated/prisma/client";
import { can, requireAccess } from "@/features/access/services/access-rules";
import type { AuthUser } from "@/features/access/types";
import { CAAR_FLAGS, DEFAULT_BAREME, analyseCaarWorkbook, type CaarAnalysis, type CaarBareme, type CaarFlag } from "@/features/caar/services/caar-engine";
import { logAction } from "@/features/journal/services/journal-service";
import { fail, ok, type ActionResult } from "@/types";
import { MONTHS_FR, todayIso } from "@/utils/dates";
import { formatDA } from "@/utils/format";

/** Fichier envoyé par le navigateur. */
export interface CaarFile {
  name: string;
  bytes: Uint8Array;
}

/** Production enregistrée (liste). */
export interface CaarProductionDTO {
  id: string;
  annee: number;
  mois: number;
  periodLabel: string;
  succursale: string;
  fichier: string;
  status: string;
  totals: { prime: number; allo: number; av: number; tva: number; ttc: number; n: number };
  anomalies: number;
  invoice: { num: string; ttc: number; date: string } | null;
}

/** Détail d'une production. */
export interface CaarProductionDetail extends CaarProductionDTO {
  tcd: Array<[string, number, number]>;
  products: Array<[string, string, number, number, number]>;
  kinds: Array<{ flag: string; label: string; severity: string; count: number }>;
  checks: Array<{ label: string; declared: number; ours: number; src: string }>;
  message: string;
  anomalyLines: Array<{ line: number; agence: string; police: string; nom: string; prime: number | null; flags: string[]; basis: string }>;
}

function obj(value: Prisma.JsonValue | unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function loadBareme(): Promise<CaarBareme> {
  const setting = await db.setting.findUnique({ where: { key: "caar" } });
  const bareme = obj(obj(setting?.value).bareme);
  const prices = obj(bareme.prices);
  return {
    prices: { ...DEFAULT_BAREME.prices, ...Object.fromEntries(Object.entries(prices).map(([key, value]) => [key, num(value)])) },
    coefs: Array.isArray(bareme.coefs) && bareme.coefs.length === 4 ? bareme.coefs.map(num) : DEFAULT_BAREME.coefs,
    avFee: bareme.avFee !== undefined ? num(bareme.avFee) : DEFAULT_BAREME.avFee,
  };
}

const ANOMALY_FLAGS = new Set<string>(Object.entries(CAAR_FLAGS).filter(([, info]) => info.severity !== "info").map(([flag]) => flag));

function toDTO(row: Prisma.CaarProductionGetPayload<Record<string, never>>): CaarProductionDTO {
  const payload = obj(row.payload);
  const totals = obj(payload.tot);
  const kinds = obj(obj(payload.stats).kinds);
  return {
    id: row.id,
    annee: row.annee,
    mois: row.mois,
    periodLabel: `${MONTHS_FR[row.mois - 1] ?? row.mois} ${row.annee}`,
    succursale: row.succursale,
    fichier: row.fichier,
    status: row.status,
    totals: { prime: num(totals.prime), allo: num(totals.allo), av: num(totals.av), tva: num(totals.tva), ttc: num(totals.ttc), n: num(totals.n) },
    anomalies: Object.entries(kinds).filter(([flag]) => ANOMALY_FLAGS.has(flag)).reduce((sum, [, count]) => sum + num(count), 0),
    invoice: payload.factureNum ? { num: String(payload.factureNum), ttc: num(payload.factureTTC), date: String(payload.factureDate ?? "") } : null,
  };
}

/** Productions CAAR contrôlées (par mois et succursale). */
export async function listProductions(actor: AuthUser): Promise<ActionResult<{ items: CaarProductionDTO[]; canEdit: boolean }>> {
  const guard = requireAccess(actor, "CAAR");
  if (!guard.success) return guard;
  const rows = await db.caarProduction.findMany({ orderBy: [{ annee: "desc" }, { mois: "desc" }, { succursale: "asc" }] });
  return ok({ items: rows.map(toDTO), canEdit: can(actor, "CAAR", "EDIT") });
}

/** Détail d'une production : TCD, produits, anomalies, message à la succursale. */
export async function getProduction(actor: AuthUser, id: string): Promise<ActionResult<CaarProductionDetail & { canEdit: boolean; canBill: boolean }>> {
  const guard = requireAccess(actor, "CAAR");
  if (!guard.success) return guard;
  const row = await db.caarProduction.findUnique({ where: { id }, include: { chunks: { orderBy: { k: "asc" } } } });
  if (!row) return fail("Production introuvable.", "NOT_FOUND");
  const payload = obj(row.payload);
  const kinds = obj(obj(payload.stats).kinds);
  const anomalies = Array.isArray(payload.anomalies) ? payload.anomalies : [];
  return ok({
    ...toDTO(row),
    tcd: Array.isArray(payload.tcd) ? (payload.tcd as Array<[string, number, number]>).map((entry) => [String(entry[0]), num(entry[1]), num(entry[2])] as [string, number, number]) : [],
    products: Array.isArray(payload.prod) ? (payload.prod as unknown[][]).map((entry) => [String(entry[0]), String(entry[1]), num(entry[2]), num(entry[3]), num(entry[4])] as [string, string, number, number, number]) : [],
    kinds: Object.entries(kinds).map(([flag, count]) => {
      const info = CAAR_FLAGS[flag as CaarFlag];
      return { flag, label: info?.label ?? flag, severity: info?.severity ?? "info", count: num(count) };
    }),
    checks: Array.isArray(payload.checks) ? payload.checks.map((check) => ({ label: String(obj(check).label ?? ""), declared: num(obj(check).declared), ours: num(obj(check).ours), src: String(obj(check).src ?? "") })) : [],
    message: String(payload.message ?? ""),
    anomalyLines: anomalies.map((entry) => {
      const item = obj(entry);
      return {
        line: num(item.line),
        agence: String(item.agence ?? ""),
        police: String(item.police ?? ""),
        nom: String(item.nom ?? ""),
        prime: item.prime === null || item.prime === undefined ? null : num(item.prime),
        flags: Array.isArray(item.flags) ? item.flags.map(String) : [],
        basis: String(item.basis ?? ""),
      };
    }),
    canEdit: can(actor, "CAAR", "EDIT"),
    canBill: can(actor, "FACT", "EDIT"),
  });
}

/** Résultat de l'aperçu d'un fichier (sans le détail des lignes). */
export type CaarPreview = Omit<CaarAnalysis, "records"> & { anomalies: number };

/** Aperçu du contrôle d'un fichier (sans enregistrement). */
export async function previewProduction(actor: AuthUser, file: CaarFile): Promise<ActionResult<CaarPreview>> {
  const guard = requireAccess(actor, "CAAR", "EDIT");
  if (!guard.success) return guard;
  let sheets;
  try {
    sheets = readWorkbook(file.bytes);
  } catch (error) {
    console.error("[caar] lecture :", error);
    return fail(`Le fichier « ${file.name} » n'a pas pu être lu.`, "VALIDATION");
  }
  const analysis = analyseCaarWorkbook(sheets, file.name, await loadBareme(), Number(todayIso().slice(0, 4)));
  if (!analysis) return fail("Colonnes non reconnues : il faut au moins le code agence, la prime et la police, le nom ou l'immatriculation.", "VALIDATION");
  const { records, ...rest } = analysis;
  return ok({ ...rest, anomalies: records.filter((record) => record.flags.some((flag) => ANOMALY_FLAGS.has(flag))).length });
}

/**
 * Contrôle et enregistre un fichier de production d'une succursale pour un mois.
 * Un nouveau dépôt pour le même mois et la même succursale remplace le précédent (version suivante).
 */
export async function saveProduction(actor: AuthUser, file: CaarFile, override: { annee: number; mois: number; succursale: string }): Promise<ActionResult<{ id: string }>> {
  const guard = requireAccess(actor, "CAAR", "EDIT");
  if (!guard.success) return guard;
  let sheets;
  try {
    sheets = readWorkbook(file.bytes);
  } catch (error) {
    console.error("[caar] lecture :", error);
    return fail(`Le fichier « ${file.name} » n'a pas pu être lu.`, "VALIDATION");
  }
  const analysis = analyseCaarWorkbook(sheets, file.name, await loadBareme(), override.annee);
  if (!analysis) return fail("Colonnes non reconnues : il faut au moins le code agence, la prime et la police, le nom ou l'immatriculation.", "VALIDATION");
  const legacyId = `caar-${override.succursale.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${override.annee}-${String(override.mois).padStart(2, "0")}`;
  const existing = await db.caarProduction.findUnique({ where: { legacyId } });
  const previousPayload = obj(existing?.payload);
  const anomalies = analysis.records.filter((record) => record.flags.some((flag) => ANOMALY_FLAGS.has(flag) || flag === "TOTAL"));
  const payload: Record<string, unknown> = {
    annee: override.annee,
    mois: override.mois,
    succ: override.succursale,
    fichier: file.name,
    onglet: analysis.sheet,
    tcd: analysis.tcd,
    prod: analysis.products,
    tot: analysis.totals,
    stats: analysis.stats,
    rates: { allo: 0.47, av: 0.9, tva: 0.19 },
    checks: analysis.declared ? [{ label: "Prime nette", declared: analysis.declared.prime, ours: analysis.totals.prime, src: `Ligne de total du fichier (ligne ${analysis.declared.line})` }] : [],
    message: analysis.message,
    anomalies: anomalies.slice(0, 500).map((record) => ({ line: record.line, agence: record.agence, police: record.police, nom: record.nom, prime: record.prime, flags: record.flags, basis: record.basis })),
    version: (Number(previousPayload.version ?? 0) || 0) + 1,
    history: [...(Array.isArray(previousPayload.history) ? previousPayload.history : []), ...(existing ? [{ fichier: existing.fichier, tot: previousPayload.tot, le: existing.updatedAt.toISOString() }] : [])].slice(-10),
    maj: { le: new Date().toISOString(), nom: actor.name, par: actor.id },
    ...(previousPayload.factureNum ? { factureId: previousPayload.factureId, factureNum: previousPayload.factureNum, factureTTC: previousPayload.factureTTC, factureDate: previousPayload.factureDate } : {}),
  };
  const rows = analysis.records.map((record) => [record.line, record.agence, record.police, record.nom, record.immat, record.effet, record.echeance, record.formule, record.product ?? "", record.prime, record.include ? 1 : 0, record.flags.join(",")]);
  const saved = await db.$transaction(async (tx) => {
    const production = existing
      ? await tx.caarProduction.update({ where: { id: existing.id }, data: { annee: override.annee, mois: override.mois, succursale: override.succursale, fichier: file.name, status: previousPayload.factureNum ? "facture" : "controle", payload: payload as Prisma.InputJsonObject } })
      : await tx.caarProduction.create({ data: { legacyId, annee: override.annee, mois: override.mois, succursale: override.succursale, fichier: file.name, status: "controle", payload: payload as Prisma.InputJsonObject } });
    await tx.caarProductionChunk.deleteMany({ where: { productionId: production.id } });
    const chunkSize = 1000;
    for (let index = 0; index * chunkSize < rows.length; index += 1) {
      await tx.caarProductionChunk.create({ data: { productionId: production.id, k: index, rows: rows.slice(index * chunkSize, (index + 1) * chunkSize) as Prisma.InputJsonValue } });
    }
    return production;
  });
  await logAction(actor, "Contrôle production CAAR", `${override.succursale} ${MONTHS_FR[override.mois - 1] ?? override.mois} ${override.annee} – ${analysis.totals.n} polices – prime ${formatDA(analysis.totals.prime)} – TTC ${formatDA(analysis.totals.ttc)}`);
  return ok({ id: saved.id });
}
