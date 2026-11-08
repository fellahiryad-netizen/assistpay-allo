import { randomUUID } from "node:crypto";
import { requireAccess, requireAdmin } from "@/features/access/services/access-rules";
import type { AuthUser } from "@/features/access/types";
import { logAction } from "@/features/journal/services/journal-service";
import { MLA_PARAMS_DEFAUT, paramsForYear, type MlaParams, type MlaParamsByYear } from "@/features/mla/services/mla-engine";
import { db } from "@/lib/db";
import { fail, ok, type ActionResult } from "@/types";

/** Brouillon de facture MLA transmis à l'éditeur de facturation (table « Setting », clé mla:draft:<id>). */
export interface MlaDraftStored {
  rows: Array<Record<string, string>>;
  /** Mois facturé (AAAA-MM) et son libellé. */
  per: string;
  perTxt: string;
  notes: string;
}

const KEY = "mla:draft:";

/** Enregistre le calcul MLA (lignes de la facture) et renvoie son identifiant. Accès « Établir une facture » en modification. */
export async function saveMlaDraft(actor: AuthUser, draft: MlaDraftStored): Promise<ActionResult<{ token: string }>> {
  const guard = requireAccess(actor, "FACT", "EDIT");
  if (!guard.success) return guard;
  if (draft.rows.length < 2 || draft.rows.length > 400) return fail("Le calcul MLA est vide ou trop long.", "VALIDATION");
  try {
    await db.setting.deleteMany({ where: { key: { startsWith: KEY }, updatedAt: { lt: new Date(Date.now() - 7 * 86400000) } } });
    const token = randomUUID();
    await db.setting.create({ data: { key: `${KEY}${token}`, value: draft as unknown as object } });
    return ok({ token });
  } catch (error) {
    console.error("[mla] brouillon impossible :", error);
    return fail("Le calcul n'a pas pu être transmis à la facturation.", "DATABASE");
  }
}

/** Relit un brouillon MLA ; null s'il n'existe plus. */
export async function readMlaDraft(token: string): Promise<MlaDraftStored | null> {
  const row = await db.setting.findUnique({ where: { key: `${KEY}${token}` } });
  const value = row?.value as unknown as MlaDraftStored | undefined;
  return value && Array.isArray(value.rows) ? value : null;
}

const PARAMS_PREFIX = "mla:params:";

function cleanParams(value: Partial<MlaParams> | undefined): MlaParams | null {
  const annuelle = Number(value?.primeAnnuelle);
  const retrait = Number(value?.primeRetraitMois);
  return annuelle > 0 && retrait > 0 ? { primeAnnuelle: annuelle, primeRetraitMois: retrait } : null;
}

/** Une version des primes d'une année : qui l'a fixée et quand. */
export interface MlaPrimeVersion extends MlaParams {
  par: string;
  le: string;
}

/** Ligne du tableau des primes : une année, ses primes en vigueur et l'historique de ses modifications. */
export interface MlaPrimeRow extends MlaParams {
  year: number;
  par: string;
  le: string;
  /** Anciennes versions, de la plus récente à la plus ancienne. */
  historique: MlaPrimeVersion[];
  /** Vrai pour 2026 tant que l'administrateur ne l'a pas modifiée. */
  parDefaut: boolean;
}

async function readPrimeRows(): Promise<MlaPrimeRow[]> {
  const rows = new Map<number, MlaPrimeRow>([[2026, { year: 2026, ...MLA_PARAMS_DEFAUT, par: "", le: "", historique: [], parDefaut: true }]]);
  try {
    const stored = await db.setting.findMany({ where: { key: { startsWith: PARAMS_PREFIX } } });
    for (const row of stored) {
      const year = Number(row.key.slice(PARAMS_PREFIX.length));
      const value = row.value as (Partial<MlaParams> & { par?: string; le?: string; historique?: MlaPrimeVersion[] }) | undefined;
      const clean = cleanParams(value);
      if (!Number.isInteger(year) || year < 2020 || !clean) continue;
      rows.set(year, { year, ...clean, par: str(value?.par), le: str(value?.le), historique: Array.isArray(value?.historique) ? value.historique : [], parDefaut: false });
    }
  } catch (error) {
    console.error("[mla] paramètres illisibles :", error);
  }
  return [...rows.values()].sort((a, b) => b.year - a.year);
}

/** Tableau des primes MLA, une ligne par année (plus récente d'abord), avec l'historique des modifications. */
export async function listMlaPrimes(): Promise<MlaPrimeRow[]> {
  return readPrimeRows();
}

/** Primes MLA figées par année. 2026 : 12 000 DA par véhicule, 1 000 DA par mois de retrait sinistré, tant que l'administrateur ne les modifie pas. */
export async function getMlaParamsByYear(): Promise<MlaParamsByYear> {
  const result: MlaParamsByYear = {};
  for (const row of await readPrimeRows()) result[String(row.year)] = { primeAnnuelle: row.primeAnnuelle, primeRetraitMois: row.primeRetraitMois };
  return result;
}

/** Enregistre les primes MLA d'une année (administrateurs). L'ancienne version reste dans l'historique de la ligne ; les autres années et les factures déjà établies ne changent pas. */
export async function saveMlaParams(actor: AuthUser, input: MlaParams & { year: number }): Promise<ActionResult<MlaParams & { year: number }>> {
  const guard = requireAdmin(actor);
  if (!guard.success) return guard;
  if (!(input.primeAnnuelle > 0) || !(input.primeRetraitMois > 0)) return fail("Les primes doivent être supérieures à zéro.", "VALIDATION");
  try {
    const rows = await readPrimeRows();
    const current = rows.find((row) => row.year === input.year);
    const before = current ?? paramsForYear(await getMlaParamsByYear(), input.year);
    const now = new Date().toISOString();
    const historique: MlaPrimeVersion[] = current ? [{ primeAnnuelle: current.primeAnnuelle, primeRetraitMois: current.primeRetraitMois, par: current.par || "Valeurs initiales", le: current.le }, ...current.historique] : [];
    const value = { primeAnnuelle: input.primeAnnuelle, primeRetraitMois: input.primeRetraitMois, par: actor.name, le: now, historique: historique.slice(0, 50) };
    const key = `${PARAMS_PREFIX}${input.year}`;
    await db.setting.upsert({ where: { key }, create: { key, value: value as unknown as object }, update: { value: value as unknown as object } });
    await logAction(actor, "Primes MLA modifiées", `année ${input.year} : par véhicule/an ${before.primeAnnuelle} → ${input.primeAnnuelle} DA ; retrait sinistré/mois ${before.primeRetraitMois} → ${input.primeRetraitMois} DA`, true);
    return ok(input);
  } catch (error) {
    console.error("[mla] enregistrement des primes impossible :", error);
    return fail("Les primes n'ont pas pu être enregistrées.", "DATABASE");
  }
}

/** Création de facture MLA conservée pour la traçabilité. */
export interface MlaHistoryEntry {
  id: string;
  num: string;
  /** Mois facturé (« Octobre 2026 »). */
  mois: string;
  creePar: string;
  creeLe: string;
  ht: number;
  ttc: number;
  /** Véhicules retirés sinistrés facturés. */
  retraits: number;
  vehicules: string;
  rectifiee: number;
  /** Dernier modificateur (rectification) ; vide si jamais modifiée. */
  modifiePar: string;
  statut: string;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Historique des factures MLA établies (depuis l'onglet ou l'éditeur), plus récentes d'abord. */
export async function listMlaHistory(actor: AuthUser): Promise<ActionResult<MlaHistoryEntry[]>> {
  const guard = requireAccess(actor, "FACT");
  if (!guard.success) return guard;
  try {
    const docs = await db.issuedInvoice.findMany({ where: { payload: { path: ["preset"], equals: "m_mla" } }, orderBy: { createdAt: "desc" }, take: 60 });
    const legacyIds = docs.map((doc) => doc.invoiceLegacyId).filter((id): id is string => Boolean(id));
    const invoices = await db.invoice.findMany({ where: { legacyId: { in: legacyIds } }, select: { legacyId: true, status: true } });
    const status = new Map(invoices.map((invoice) => [invoice.legacyId, invoice.status]));
    return ok(
      docs.map((doc) => {
        const payload = (doc.payload ?? {}) as Record<string, unknown>;
        const rows = Array.isArray(payload.rows) ? (payload.rows as Array<Record<string, string>>) : [];
        const cree = (payload.cree ?? {}) as Record<string, unknown>;
        const maj = (payload.maj ?? {}) as Record<string, unknown>;
        const rectifiee = Number(payload.rectifiee ?? 0) || 0;
        return {
          id: doc.id,
          num: doc.num,
          mois: str(payload.perTxt),
          creePar: str(cree.nom),
          creeLe: str(cree.le) || doc.createdAt.toISOString(),
          ht: Number(doc.ht),
          ttc: Number(doc.ttc),
          retraits: rows.slice(2).filter((row) => !row.info && row.des).length,
          vehicules: str(rows[0]?.qte),
          rectifiee,
          modifiePar: rectifiee > 0 ? str(maj.nom) : "",
          statut: (doc.invoiceLegacyId ? status.get(doc.invoiceLegacyId) : "") ?? "",
        };
      }),
    );
  } catch (error) {
    console.error("[mla] historique illisible :", error);
    return fail("L'historique des factures MLA n'a pas pu être lu.", "DATABASE");
  }
}

/** Fichier de production MLA conservé (sans son contenu). */
export interface MlaFileInfo {
  id: string;
  kind: "flotte" | "activite";
  month: string;
  name: string;
  size: number;
  uploadedBy: string;
  createdAt: string;
}

const MAX_FILE = 3_500_000;

/**
 * Conserve les fichiers de production du mois traité (flotte et/ou activités). Rien n'est jamais écrasé : un nouveau dépôt crée une nouvelle version.
 * Un fichier identique (même nom et même taille) déjà conservé pour ce mois n'est pas dupliqué.
 */
export async function saveMlaFiles(actor: AuthUser, input: { month: string; files: Array<{ kind: "flotte" | "activite"; name: string; data: Uint8Array }> }): Promise<ActionResult<{ saved: number }>> {
  const guard = requireAccess(actor, "FACT", "EDIT");
  if (!guard.success) return guard;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.month)) return fail("Mois invalide.", "VALIDATION");
  try {
    let saved = 0;
    for (const file of input.files) {
      if (file.data.byteLength > MAX_FILE) return fail(`« ${file.name} » dépasse 3,5 Mo : il ne peut pas être conservé dans la fiche.`, "VALIDATION");
      const same = await db.mlaFile.findFirst({ where: { month: input.month, kind: file.kind, name: file.name, size: file.data.byteLength }, select: { id: true } });
      if (same) continue;
      await db.mlaFile.create({ data: { kind: file.kind, month: input.month, name: file.name, size: file.data.byteLength, data: file.data, uploadedBy: actor.name } });
      await logAction(actor, "Fichier MLA conservé", `${input.month} – ${file.kind === "flotte" ? "flotte" : "activités"} – ${file.name} (${Math.round(file.data.byteLength / 1024)} Ko)`);
      saved += 1;
    }
    return ok({ saved });
  } catch (error) {
    console.error("[mla] fichiers non conservés :", error);
    return fail("Les fichiers n'ont pas pu être conservés dans la fiche MLA.", "DATABASE");
  }
}

/** Liste des fichiers de production conservés, plus récents d'abord. */
export async function listMlaFiles(actor: AuthUser): Promise<ActionResult<MlaFileInfo[]>> {
  const guard = requireAccess(actor, "FACT");
  if (!guard.success) return guard;
  try {
    const rows = await db.mlaFile.findMany({ select: { id: true, kind: true, month: true, name: true, size: true, uploadedBy: true, createdAt: true }, orderBy: [{ month: "desc" }, { createdAt: "desc" }], take: 200 });
    return ok(rows.map((row: { id: string; kind: string; month: string; name: string; size: number; uploadedBy: string; createdAt: Date }) => ({ id: row.id, kind: row.kind === "activite" ? "activite" : "flotte", month: row.month, name: row.name, size: row.size, uploadedBy: row.uploadedBy, createdAt: row.createdAt.toISOString() })));
  } catch (error) {
    console.error("[mla] liste des fichiers impossible :", error);
    return fail("La liste des fichiers n'a pas pu être lue.", "DATABASE");
  }
}

/** Contenu d'un fichier conservé (téléchargement). */
export async function readMlaFile(actor: AuthUser, id: string): Promise<ActionResult<{ name: string; data: Uint8Array }>> {
  const guard = requireAccess(actor, "FACT");
  if (!guard.success) return guard;
  try {
    const row = await db.mlaFile.findUnique({ where: { id } });
    if (!row) return fail("Fichier introuvable.", "NOT_FOUND");
    return ok({ name: row.name, data: new Uint8Array(row.data) });
  } catch (error) {
    console.error("[mla] lecture du fichier impossible :", error);
    return fail("Le fichier n'a pas pu être lu.", "DATABASE");
  }
}
