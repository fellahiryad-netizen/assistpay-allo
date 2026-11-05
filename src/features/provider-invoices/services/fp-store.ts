import { z } from "zod";
import { autoRequestForInvoice } from "@/features/payment-requests/services/payment-request-service";
import { requireAccess } from "@/features/access/services/access-rules";
import type { AuthUser } from "@/features/access/types";
import { logAction } from "@/features/journal/services/journal-service";
import { formatNum, FP_STATUTS, FP_SUIVANT, gaps, lastNumber, parseNum, type FpPrestataire, type FpProduit, type FpRequest, type FpStatut } from "@/features/provider-invoices/services/fp-engine";
import initial from "@/features/provider-invoices/data/initial.json";
import { db } from "@/lib/db";
import { fail, ok, type ActionResult } from "@/types";
import { todayIso } from "@/utils/dates";

/* Stockage dans la table « Setting » : une ligne par facture (fp:req:<id>) et la liste des prestataires (fp:prest). */
const REQ = "fp:req:";
const PREST = "fp:prest";

/** Contenu de l'écran. */
export interface FpOverview {
  reqs: FpRequest[];
  prest: FpPrestataire[];
  year: number;
  today: string;
  info: Record<FpProduit, { last: FpRequest | null; next: string; gaps: string[] }>;
}

async function readPrest(): Promise<FpPrestataire[]> {
  const row = await db.setting.findUnique({ where: { key: PREST } });
  return Array.isArray(row?.value) ? (row.value as unknown as FpPrestataire[]) : [];
}

async function readReqs(): Promise<FpRequest[]> {
  const rows = await db.setting.findMany({ where: { key: { startsWith: REQ } } });
  return rows.map((row) => row.value as unknown as FpRequest);
}

async function writeJson(key: string, value: unknown): Promise<void> {
  const json = JSON.parse(JSON.stringify(value)) as never;
  await db.setting.upsert({ where: { key }, create: { key, value: json }, update: { value: json } });
}

/** Première ouverture : reprend les deux tableaux de l'ancien fichier FACTURE_2026 (une seule fois). */
async function seedOnce(): Promise<void> {
  if (await db.setting.findUnique({ where: { key: "fp:seeded" } })) return;
  await writeJson("fp:seeded", { le: new Date().toISOString(), source: "FACTURE_2026.xlsx" });
  const existing = await db.setting.count({ where: { key: { startsWith: REQ } } });
  if (existing === 0) {
    await Promise.all(initial.factures.map((item, index) => {
      const id = `i${String(index).padStart(3, "0")}`;
      const date = item.date ?? "2026-01-01";
      const keep = item.obs === "CACHET" || item.obs === "CACHET / ENVOYER" ? "" : item.obs;
      const req: FpRequest = { id, p: item.p as FpProduit, nom: item.nom.toUpperCase(), prenom: item.prenom.toUpperCase(), num: item.num, date, mt: item.mt, obs: keep, st: item.st as FpStatut, dd: item.dd, envoyeLe: item.st === "ENVOYEE" ? date : null, hist: [{ st: "CREE", le: `${date}T08:00:00.000Z`, par: "Reprise du fichier FACTURE_2026" }] };
      return writeJson(`${REQ}${id}`, req);
    }));
  }
  if ((await readPrest()).length === 0) {
    await writeJson(PREST, initial.prestataires.map((item, index) => ({ id: `p${String(index).padStart(2, "0")}`, nom: item.nom.toUpperCase(), email: item.email, actif: true })));
  }
}

/** Factures, prestataires et derniers numéros. */
export async function fpOverview(actor: AuthUser): Promise<ActionResult<FpOverview>> {
  const guard = requireAccess(actor, "FFOUR");
  if (!guard.success) return guard;
  try {
    await seedOnce();
    const [reqs, prest] = await Promise.all([readReqs(), readPrest()]);
    const today = todayIso();
    const year = Number(today.slice(0, 4));
    const info = (p: FpProduit): FpOverview["info"][FpProduit] => ({ ...lastNumber(reqs, p, year), gaps: gaps(reqs, p, year) });
    reqs.sort((a, b) => b.num.localeCompare(a.num));
    return ok({ reqs, prest, year, today, info: { A: info("A"), B: info("B") } });
  } catch (error) {
    console.error("[factures-prestataires] lecture :", error);
    return fail("Le suivi des factures prestataires n'a pas pu être lu.", "DATABASE");
  }
}

/** Nombre de factures à établir (pastille du menu). */
export async function countToIssue(actor: AuthUser): Promise<number> {
  if (!requireAccess(actor, "FFOUR").success) return 0;
  try {
    return (await readReqs()).filter((req) => req.st === "A_ETABLIR").length;
  } catch {
    return 0;
  }
}

const createSchema = z.object({ p: z.enum(["A", "B"]), nom: z.string().trim().min(2).max(80), prenom: z.string().trim().max(80), num: z.string().trim().max(30) });
/** Données d'une nouvelle demande. */
export type FpCreateInput = z.infer<typeof createSchema>;

/** Soheib enregistre une demande : prestataire et numéro pris au portail ; le chargé de facturation la voit dans « À établir ». */
export async function fpCreate(actor: AuthUser, input: FpCreateInput): Promise<ActionResult<FpRequest>> {
  const guard = requireAccess(actor, "FFOUR", "EDIT");
  if (!guard.success) return guard;
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return fail("Renseignez le prestataire et le numéro de facture.", "VALIDATION");
  const data = parsed.data;
  const n = parseNum(data.num);
  if (!n || n.p !== data.p) return fail(`Numéro incorrect : attendu ${data.p === "A" ? "FACT00000/2026" : "BDG00000/2026"}.`, "VALIDATION");
  const num = formatNum(n.p, n.n, n.year);
  try {
    const reqs = await readReqs();
    const twin = reqs.find((req) => req.num === num && req.st !== "ANNULEE");
    if (twin) return fail(`Le numéro ${num} est déjà utilisé pour ${twin.nom} ${twin.prenom}.`, "VALIDATION");
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const req: FpRequest = { id, p: data.p, nom: data.nom.toUpperCase(), prenom: data.prenom.toUpperCase(), num, date: todayIso(), mt: null, obs: "", st: "A_ETABLIR", hist: [{ st: "CREE", le: now, par: actor.name }] };
    await writeJson(`${REQ}${id}`, req);
    await logAction(actor, "Facture prestataire demandée", `${num} – ${req.nom} ${req.prenom}`);
    return ok(req);
  } catch (error) {
    console.error("[factures-prestataires] création :", error);
    return fail("La demande n'a pas pu être enregistrée.", "DATABASE");
  }
}

const moveSchema = z.object({ id: z.string().min(1).max(64), to: z.enum(["A_ETABLIR", "ENVOYEE", "A_PAYER", "PAYEE", "ANNULEE"]), mt: z.number().finite().positive().optional(), obs: z.string().max(200).optional() });
/** Changement d'étape. */
export type FpMoveInput = z.infer<typeof moveSchema>;

/** Fait avancer (ou corrige) l'étape d'une facture ; le montant est exigé quand la facture est établie. */
export async function fpMove(actor: AuthUser, input: FpMoveInput): Promise<ActionResult<FpRequest>> {
  const guard = requireAccess(actor, "FFOUR", "EDIT");
  if (!guard.success) return guard;
  const parsed = moveSchema.safeParse(input);
  if (!parsed.success) return fail("Données invalides.", "VALIDATION");
  const { id, to, mt, obs } = parsed.data;
  try {
    const row = await db.setting.findUnique({ where: { key: `${REQ}${id}` } });
    if (!row) return fail("Facture introuvable.", "NOT_FOUND");
    const req = row.value as unknown as FpRequest;
    const forward = FP_SUIVANT[req.st] === to;
    if (!forward && to !== "ANNULEE" && !actor.isAdmin) return fail("Seul un administrateur peut revenir à une étape précédente.", "FORBIDDEN");
    if (to === "ENVOYEE" && !(mt ?? req.mt)) return fail("Saisissez le montant de la facture établie.", "VALIDATION");
    const today = todayIso();
    const next: FpRequest = { ...req, st: to as FpStatut, mt: mt ?? req.mt, obs: obs ?? req.obs, hist: [...req.hist, { st: to as FpStatut, le: new Date().toISOString(), par: actor.name }] };
    if (to === "ENVOYEE") {
      next.envoyeLe = today;
      // La facture établie rejoint les factures fournisseurs (en attente), sauf si elle y figure déjà.
      const tiers = `${req.nom} ${req.prenom}`.replace(/\s+/g, " ").trim();
      const existing = await db.invoice.findFirst({ where: { sens: "DEBIT", numero: { equals: req.num, mode: "insensitive" }, status: { not: "ANNULE" } }, select: { legacyId: true } });
      if (existing) next.invoiceLegacyId = existing.legacyId;
      else {
        const legacyId = `fp-${req.id}`;
        const created = await db.invoice.create({
          data: {
            legacyId,
            sens: "DEBIT",
            status: "EN_ATTENTE",
            categorie: req.p === "B" ? "Prestataire BDG" : "Prestataire assistance routière",
            tiers,
            numero: req.num,
            libelle: req.p === "B" ? "Sinistre BDG 2026" : "SINISTRE ASSISTANCE ROUTIERE",
            montant: next.mt ?? 0,
            dateFacture: new Date(`${today}T00:00:00Z`),
            annee: Number(today.slice(0, 4)),
            nature: "Charge",
            origine: "factures prestataires",
            ordre: Date.now(),
            createdById: actor.id,
            updatedById: actor.id,
            extra: { dateDoc: req.date },
          },
        });
        next.invoiceLegacyId = legacyId;
        await autoRequestForInvoice(actor, created.id);
      }
    }
    if (to === "A_PAYER") next.recuLe = today;
    await writeJson(`${REQ}${id}`, next);
    await logAction(actor, "Facture prestataire", `${req.num} : ${FP_STATUTS[to as FpStatut]}${mt ? ` – ${mt}` : ""}`);
    return ok(next);
  } catch (error) {
    console.error("[factures-prestataires] étape :", error);
    return fail("Le changement n'a pas pu être enregistré.", "DATABASE");
  }
}

/** Supprime une ligne du suivi (la facture fournisseur déjà créée n'est pas touchée). */
export async function fpDelete(actor: AuthUser, id: string): Promise<ActionResult<true>> {
  const guard = requireAccess(actor, "FFOUR", "EDIT");
  if (!guard.success) return guard;
  const row = await db.setting.findUnique({ where: { key: `${REQ}${id}` } });
  if (!row) return fail("Facture introuvable.", "NOT_FOUND");
  const req = row.value as unknown as FpRequest;
  await db.setting.delete({ where: { key: `${REQ}${id}` } });
  await logAction(actor, "Facture prestataire supprimée du suivi", `${req.num} – ${req.nom} ${req.prenom}`);
  return ok(true);
}

const noteSchema = z.object({ id: z.string().min(1).max(64), obs: z.string().max(200) });
/** Observation libre d'une facture (par exemple « erreur de montant »). */
export async function fpNote(actor: AuthUser, input: z.infer<typeof noteSchema>): Promise<ActionResult<true>> {
  const guard = requireAccess(actor, "FFOUR", "EDIT");
  if (!guard.success) return guard;
  const parsed = noteSchema.safeParse(input);
  if (!parsed.success) return fail("Données invalides.", "VALIDATION");
  const row = await db.setting.findUnique({ where: { key: `${REQ}${parsed.data.id}` } });
  if (!row) return fail("Facture introuvable.", "NOT_FOUND");
  await writeJson(`${REQ}${parsed.data.id}`, { ...(row.value as unknown as FpRequest), obs: parsed.data.obs });
  return ok(true);
}

const prestSchema = z.object({ id: z.string().max(64).optional(), nom: z.string().trim().min(2).max(80), email: z.string().trim().toLowerCase().email().max(120), actif: z.boolean().default(true) });
/** Prestataire à enregistrer. */
export type FpPrestInput = z.infer<typeof prestSchema>;

/** Ajoute ou modifie un prestataire de la liste d'envoi (nom et e-mail). */
export async function fpSavePrest(actor: AuthUser, input: FpPrestInput): Promise<ActionResult<true>> {
  const guard = requireAccess(actor, "FFOUR", "EDIT");
  if (!guard.success) return guard;
  const parsed = prestSchema.safeParse(input);
  if (!parsed.success) return fail("Nom et adresse e-mail valides requis.", "VALIDATION");
  const list = await readPrest();
  const data = parsed.data;
  const index = data.id ? list.findIndex((item) => item.id === data.id) : -1;
  const entry: FpPrestataire = { id: data.id ?? crypto.randomUUID(), nom: data.nom.toUpperCase(), email: data.email, actif: data.actif };
  if (index >= 0) list[index] = entry;
  else list.push(entry);
  list.sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
  await writeJson(PREST, list);
  await logAction(actor, "Prestataire (envoi des factures)", `${entry.nom} – ${entry.email}`);
  return ok(true);
}

/** Reporte un nouveau montant de facture fournisseur sur la demande de facture prestataire correspondante. */
export async function fpSyncAmount(actor: AuthUser, invoiceLegacyId: string, montant: number): Promise<void> {
  try {
    const found = (await readReqs()).find((req) => req.invoiceLegacyId === invoiceLegacyId);
    if (!found || found.mt === montant) return;
    await writeJson(`${REQ}${found.id}`, { ...found, mt: montant });
    await logAction(actor, "Facture prestataire", `${found.num} : montant corrigé ${found.mt ?? "—"} → ${montant}`);
  } catch (error) {
    console.error("[factures-prestataires] synchronisation du montant impossible :", error);
  }
}

/** La facture fournisseur liée a été supprimée : la demande de facture prestataire retourne à « À établir ». */
export async function fpInvoiceDeleted(actor: AuthUser, invoiceLegacyId: string): Promise<void> {
  try {
    const found = (await readReqs()).find((req) => req.invoiceLegacyId === invoiceLegacyId);
    if (!found) return;
    const { invoiceLegacyId: _removed, ...rest } = found;
    await writeJson(`${REQ}${found.id}`, { ...rest, st: "A_ETABLIR", hist: [...found.hist, { st: "A_ETABLIR", le: new Date().toISOString(), par: actor.name }] });
    await logAction(actor, "Facture prestataire", `${found.num} : facture supprimée, retour à « À établir »`);
  } catch (error) {
    console.error("[factures-prestataires] retour à établir impossible :", error);
  }
}
