import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { can, requireAccess } from "@/features/access/services/access-rules";
import type { AuthUser } from "@/features/access/types";
import { CLIENT_LABELS } from "@/features/billing/config";
import { getControlSettings } from "@/features/settings/services/settings-service";
import { decimalToNumber } from "@/features/invoices/services/invoice-mapper";
import { logAction } from "@/features/journal/services/journal-service";
import { avoirAmounts, manualAvoirAmounts, nextAvoirNumber, remainingAvoirable, type AvoirAmounts } from "@/features/avoirs/lib/avoir-calc";
import { AVOIR_MOTIF_LABELS, type CancelAvoirInput, type CreateAvoirInput } from "@/features/avoirs/schemas";
import type { AvoirableInvoiceDTO, AvoirDTO, AvoirPrintData, AvoirTrackingDTO } from "@/features/avoirs/types";
import { fail, ok, type ActionResult } from "@/types";
import { amountInWords } from "@/utils/amounts";
import { toIsoDate, todayIso } from "@/utils/dates";
import { formatDA } from "@/utils/format";

/* Les avoirs sont des enregistrements « IssuedInvoice » marqués payload.kind = "avoir" : montants négatifs, aucun lien avec le suivi
   (aucune ligne « Invoice » n'est créée, pour ne pas fausser les créances, relances et rapprochements). */

function obj(value: Prisma.JsonValue | undefined): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

const str = (value: unknown): string => (typeof value === "string" ? value : value === null || value === undefined ? "" : String(value));

const isAvoir = (payload: Prisma.JsonValue): boolean => str(obj(payload).kind) === "avoir";
const isActive = (payload: Prisma.JsonValue): boolean => str(obj(obj(payload).avoir as Prisma.JsonValue).statut) !== "annule";
const originOf = (payload: Prisma.JsonValue): string => str(obj(obj(payload).avoir as Prisma.JsonValue).origineId);

function guardCreate(actor: AuthUser): ActionResult<true> {
  const view = requireAccess(actor, "FACT", "EDIT");
  if (!view.success) return view;
  if (!can(actor, "A_RECT", "EDIT")) return fail("Vous n'avez pas le droit de corriger une facture établie.", "FORBIDDEN");
  return ok(true);
}

/** Factures établies (hors avoirs) avec ce qui a déjà été passé en avoir ; sert à choisir la facture à corriger. */
export async function listAvoirable(actor: AuthUser): Promise<ActionResult<AvoirableInvoiceDTO[]>> {
  const guard = requireAccess(actor, "FACT");
  if (!guard.success) return guard;
  const docs = await db.issuedInvoice.findMany({ orderBy: [{ date: "desc" }, { num: "desc" }], take: 1500 });
  const avoirs = docs.filter((doc) => isAvoir(doc.payload) && isActive(doc.payload));
  const spent = new Map<string, number[]>();
  for (const doc of avoirs) spent.set(originOf(doc.payload), [...(spent.get(originOf(doc.payload)) ?? []), decimalToNumber(doc.ttc) ?? 0]);
  const legacyIds = docs.map((doc) => doc.invoiceLegacyId).filter((id): id is string => Boolean(id));
  const invoices = legacyIds.length ? await db.invoice.findMany({ where: { legacyId: { in: legacyIds } }, select: { legacyId: true, status: true } }) : [];
  const status = new Map(invoices.map((invoice) => [invoice.legacyId, invoice.status]));
  return ok(
    docs
      .filter((doc) => !isAvoir(doc.payload) && (decimalToNumber(doc.ttc) ?? 0) > 0)
      .map((doc) => {
        const payload = obj(doc.payload);
        const ttc = decimalToNumber(doc.ttc) ?? 0;
        const used = spent.get(doc.id) ?? [];
        return {
          id: doc.id,
          num: doc.num,
          num2: str(payload.num2),
          client: doc.client,
          clientLabel: CLIENT_LABELS[doc.client] ?? doc.client,
          succ: str(payload.succ),
          date: toIsoDate(doc.date),
          objet: doc.objet,
          perTxt: str(payload.perTxt),
          ht: decimalToNumber(doc.ht) ?? 0,
          tva: decimalToNumber(doc.tva) ?? 0,
          ttc,
          avoirs: Math.round(used.reduce((sum, value) => sum + Math.abs(value), 0) * 100) / 100,
          reste: remainingAvoirable(ttc, used),
          statut: doc.invoiceLegacyId ? (status.get(doc.invoiceLegacyId) ?? null) : null,
        };
      }),
  );
}

/** Avoirs émis (les plus récents d'abord). */
export async function listAvoirs(actor: AuthUser): Promise<ActionResult<AvoirDTO[]>> {
  const guard = requireAccess(actor, "FACT");
  if (!guard.success) return guard;
  const docs = await db.issuedInvoice.findMany({ orderBy: [{ date: "desc" }, { num: "desc" }], take: 1500 });
  return ok(
    docs
      .filter((doc) => isAvoir(doc.payload))
      .map((doc) => {
        const avoir = obj(obj(doc.payload).avoir as Prisma.JsonValue);
        return {
          id: doc.id,
          num: doc.num,
          client: doc.client,
          clientLabel: CLIENT_LABELS[doc.client] ?? doc.client,
          date: toIsoDate(doc.date),
          origineNum: str(avoir.origineNum),
          origineId: str(avoir.origineId),
          origineTtc: Number(avoir.origineTtc) || 0,
          ht: Math.abs(decimalToNumber(doc.ht) ?? 0),
          tva: Math.abs(decimalToNumber(doc.tva) ?? 0),
          ttc: Math.abs(decimalToNumber(doc.ttc) ?? 0),
          mode: str(avoir.mode),
          motif: str(avoir.motifTexte),
          annule: !isActive(doc.payload),
          suite: str(avoir.suite),
        };
      }),
  );
}

/**
 * Suivi des avoirs d'une facture établie, retrouvée par la ligne du suivi à laquelle elle se rattache (fiche facture).
 * Renvoie null s'il n'y a pas de facture établie liée ou pas d'avoir : la fiche n'affiche alors rien. Lecture seule.
 */
export async function getAvoirTrackingForInvoice(actor: AuthUser, invoiceLegacyId: string): Promise<ActionResult<AvoirTrackingDTO | null>> {
  const guard = requireAccess(actor, "FACT");
  if (!guard.success) return guard;
  try {
    const origin = await db.issuedInvoice.findFirst({ where: { invoiceLegacyId } });
    if (!origin || isAvoir(origin.payload)) return ok(null);
    const rows = await db.issuedInvoice.findMany({
      where: { AND: [{ payload: { path: ["kind"], equals: "avoir" } }, { payload: { path: ["avoir", "origineId"], equals: origin.id } }] },
      orderBy: [{ date: "desc" }, { num: "desc" }],
    });
    if (rows.length === 0) return ok(null);
    const originTtc = decimalToNumber(origin.ttc) ?? 0;
    const avoirs = rows.map((row) => ({
      id: row.id,
      num: row.num,
      date: toIsoDate(row.date),
      ttc: Math.abs(decimalToNumber(row.ttc) ?? 0),
      motif: str(obj(obj(row.payload).avoir as Prisma.JsonValue).motifTexte),
      annule: !isActive(row.payload),
    }));
    const totalAvoirs = Math.round(avoirs.filter((item) => !item.annule).reduce((sum, item) => sum + item.ttc, 0) * 100) / 100;
    return ok({
      origineId: origin.id,
      origineNum: [origin.num, str(obj(origin.payload).num2)].filter(Boolean).join(" / "),
      origineTtc: originTtc,
      avoirs,
      totalAvoirs,
      netRestant: Math.round((originTtc - totalAvoirs) * 100) / 100,
    });
  } catch (error) {
    console.error("[avoirs] suivi impossible :", error);
    return fail("Le suivi des avoirs n'a pas pu être chargé.", "DATABASE");
  }
}

/** Établit un avoir sur une facture déjà émise (total ou partiel). */
export async function createAvoir(actor: AuthUser, input: CreateAvoirInput): Promise<ActionResult<{ id: string; num: string }>> {
  const guard = guardCreate(actor);
  if (!guard.success) return guard;
  const origin = await db.issuedInvoice.findUnique({ where: { id: input.origineId } });
  if (!origin) return fail("Facture introuvable.", "NOT_FOUND");
  if (isAvoir(origin.payload)) return fail("On ne peut pas faire un avoir sur un avoir.", "VALIDATION");
  const originAmounts = { ht: decimalToNumber(origin.ht) ?? 0, tva: decimalToNumber(origin.tva) ?? 0, ttc: decimalToNumber(origin.ttc) ?? 0 };
  if (!(originAmounts.ttc > 0)) return fail("Cette facture n'a pas de montant à corriger.", "VALIDATION");
  const date = input.date ?? todayIso();
  const originDate = toIsoDate(origin.date);
  if (originDate && date < originDate) return fail("La date de l'avoir ne peut pas précéder celle de la facture.", "VALIDATION");
  const year = Number(date.slice(0, 4));
  const motifTexte = [AVOIR_MOTIF_LABELS[input.categorie], input.motif].filter(Boolean).join(" : ");
  try {
    const created = await db.$transaction(
      async (tx) => {
        const docs = await tx.issuedInvoice.findMany({ select: { id: true, num: true, ttc: true, payload: true } });
        const used = docs.filter((doc) => isAvoir(doc.payload) && isActive(doc.payload) && originOf(doc.payload) === origin.id).map((doc) => decimalToNumber(doc.ttc) ?? 0);
        const reste = remainingAvoirable(originAmounts.ttc, used);
        if (reste <= 0.005) throw new AvoirError("Cette facture est déjà entièrement couverte par des avoirs.");
        let amounts: AvoirAmounts;
        let ecartArrondi = 0;
        if (input.mode === "manuel") {
          if (input.saisie === undefined || input.montant === undefined) throw new AvoirError("Indiquez le montant de l'avoir (HT ou TTC).");
          const manual = manualAvoirAmounts(input.saisie, input.montant);
          if (!manual.coherent) throw new AvoirError("Contrôle d'arrondi : HT + TVA ne correspond pas au TTC. Vérifiez le montant saisi.");
          ecartArrondi = manual.ecartArrondi;
          amounts = { ht: manual.ht, tva: manual.tva, ttc: manual.ttc };
        } else {
          amounts = avoirAmounts(originAmounts, input.mode, input.mode === "total" ? undefined : input.ttc);
        }
        const wanted = input.mode === "total" ? reste : amounts.ttc;
        if (!(wanted > 0)) throw new AvoirError("Le montant de l'avoir doit être supérieur à zéro.");
        if (wanted > reste + 0.005) throw new AvoirError(`Le montant (${formatDA(wanted)} TTC) dépasse le reste avoirable de cette facture (${formatDA(reste)}).`);
        // Avoir « total » : si des avoirs partiels existent déjà, il couvre le reste de la facture.
        const final = input.mode === "total" && used.length ? avoirAmounts(originAmounts, "partiel", reste) : amounts;
        const num = nextAvoirNumber(docs.filter((doc) => isAvoir(doc.payload)).map((doc) => doc.num), year);
        const payload = obj(origin.payload);
        const settings = await getControlSettings();
        const data: Prisma.InputJsonValue = {
          kind: "avoir",
          preset: "avoir",
          client: origin.client,
          cli: obj(payload.cli as Prisma.JsonValue) as Prisma.InputJsonObject,
          num,
          date,
          succ: str(payload.succ),
          emAi: str(payload.emAi) || settings.articleImposition,
          avoir: {
            origineId: origin.id,
            origineNum: [origin.num, str(payload.num2)].filter(Boolean).join(" / "),
            origineDate: originDate,
            origineSucc: str(payload.succ),
            origineObjet: origin.objet,
            originePerTxt: str(payload.perTxt),
            origineHt: originAmounts.ht,
            origineTva: originAmounts.tva,
            origineTtc: originAmounts.ttc,
            mode: input.mode,
            saisie: input.mode === "manuel" ? input.saisie : null,
            ecartArrondi,
            categorie: input.categorie,
            motifTexte,
            suite: input.suite,
            statut: "actif",
          },
          cree: { le: new Date().toISOString(), nom: actor.name, par: actor.id },
        };
        const row = await tx.issuedInvoice.create({
          data: {
            legacyId: `av-${randomUUID()}`,
            num,
            client: origin.client,
            date: new Date(`${date}T12:00:00Z`),
            ht: -final.ht,
            tva: -final.tva,
            ttc: -final.ttc,
            objet: `Avoir sur facture ${[origin.num, str(payload.num2)].filter(Boolean).join(" / ")}`,
            invoiceLegacyId: null,
            payload: data,
          },
        });
        return { id: row.id, num, ttc: final.ttc };
      },
      { isolationLevel: "Serializable" },
    );
    await logAction(actor, "Avoir établi", `${created.num} – ${CLIENT_LABELS[origin.client] ?? origin.client} – facture ${origin.num} – −${formatDA(created.ttc)} – ${motifTexte}`);
    return ok({ id: created.id, num: created.num });
  } catch (error) {
    if (error instanceof AvoirError) return fail(error.message, "VALIDATION");
    console.error("[avoirs] création impossible :", error);
    return fail("L'avoir n'a pas pu être enregistré. Réessayez.", "DATABASE");
  }
}

class AvoirError extends Error {}

/** Annule un avoir (il reste visible et son numéro n'est pas réutilisé). */
export async function cancelAvoir(actor: AuthUser, input: CancelAvoirInput): Promise<ActionResult<{ num: string }>> {
  const guard = guardCreate(actor);
  if (!guard.success) return guard;
  const doc = await db.issuedInvoice.findUnique({ where: { id: input.id } });
  if (!doc || !isAvoir(doc.payload)) return fail("Avoir introuvable.", "NOT_FOUND");
  if (!isActive(doc.payload)) return fail("Cet avoir est déjà annulé.", "CONFLICT");
  const payload = obj(doc.payload);
  const avoir = obj(payload.avoir as Prisma.JsonValue);
  try {
    await db.issuedInvoice.update({
      where: { id: doc.id },
      data: { payload: { ...payload, avoir: { ...avoir, statut: "annule", annule: { le: new Date().toISOString(), par: actor.id, motif: input.motif } } } as Prisma.InputJsonValue },
    });
    await logAction(actor, "Avoir annulé", `${doc.num} – ${formatDA(Math.abs(decimalToNumber(doc.ttc) ?? 0))} – motif : ${input.motif}`);
    return ok({ num: doc.num });
  } catch (error) {
    console.error("[avoirs] annulation impossible :", error);
    return fail("L'avoir n'a pas pu être annulé.", "DATABASE");
  }
}

/** Données d'impression d'un avoir. */
export async function getAvoirForPrint(actor: AuthUser, id: string): Promise<ActionResult<AvoirPrintData>> {
  const guard = requireAccess(actor, "FACT");
  if (!guard.success) return guard;
  const doc = await db.issuedInvoice.findUnique({ where: { id } });
  if (!doc || !isAvoir(doc.payload)) return fail("Avoir introuvable.", "NOT_FOUND");
  const payload = obj(doc.payload);
  const avoir = obj(payload.avoir as Prisma.JsonValue);
  const cli = obj(payload.cli as Prisma.JsonValue);
  const siblings = await db.issuedInvoice.findMany({ select: { id: true, ttc: true, date: true, num: true, payload: true } });
  const earlier = siblings
    .filter((other) => other.id !== doc.id && isAvoir(other.payload) && isActive(other.payload) && originOf(other.payload) === originOf(doc.payload) && other.num < doc.num)
    .map((other) => Math.abs(decimalToNumber(other.ttc) ?? 0));
  const earlierTotal = Math.round(earlier.reduce((sum, value) => sum + value, 0) * 100) / 100;
  const originTtc = Number(avoir.origineTtc) || 0;
  const ttc = decimalToNumber(doc.ttc) ?? 0;
  return ok({
    num: doc.num,
    date: toIsoDate(doc.date),
    annule: !isActive(doc.payload),
    cli: { nom: str(cli.nom), adresse: str(cli.adresse), tel: str(cli.tel), rc: str(cli.rc), nif: str(cli.nif), nis: str(cli.nis), ai: str(cli.ai) },
    origine: { num: str(avoir.origineNum), date: str(avoir.origineDate) || null, succ: str(avoir.origineSucc), perTxt: str(avoir.originePerTxt), ht: Number(avoir.origineHt) || 0, tva: Number(avoir.origineTva) || 0, ttc: originTtc },
    motif: str(avoir.motifTexte),
    suite: str(avoir.suite),
    ht: decimalToNumber(doc.ht) ?? 0,
    tva: decimalToNumber(doc.tva) ?? 0,
    ttc,
    avoirsPrecedents: earlierTotal,
    netRestant: Math.max(0, Math.round((originTtc - earlierTotal - Math.abs(ttc)) * 100) / 100),
    lettres: amountInWords(Math.abs(ttc)),
    emAi: str(payload.emAi),
  });
}
