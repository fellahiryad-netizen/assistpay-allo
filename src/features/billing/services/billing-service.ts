import { db } from "@/lib/db";
import { getControlSettings } from "@/features/settings/services/settings-service";
import type { Prisma } from "@/generated/prisma/client";
import { can, requireAccess } from "@/features/access/services/access-rules";
import type { AuthUser } from "@/features/access/types";
import { BRANCHES, CLIENTS, CLIENT_LABELS, MODELS, PRESETS, presetById, r2, num, type BillingRow } from "@/features/billing/config";
import type { PrepareBillingInput, SaveBillingInput } from "@/features/billing/schemas";
import {
  computeBilling,
  nextCaatBdgNumbers,
  nextClientNumber,
  nextGamAbNumber,
  nextTrustBdgNumbers,
  periodLabel,
  presetRows,
  trackingLabel,
} from "@/features/billing/services/billing-calc";
import type { BillingClientInfo, BillingDraft, IssuedInvoiceDTO } from "@/features/billing/types";
import { readExtra, writeExtra } from "@/features/invoices/services/invoice-extra";
import { decimalToNumber } from "@/features/invoices/services/invoice-mapper";
import { logAction } from "@/features/journal/services/journal-service";
import { fail, ok, type ActionResult } from "@/types";
import { amountInWords } from "@/utils/amounts";
import { fromIsoDate, shiftIsoDate, toIsoDate, todayIso } from "@/utils/dates";
import { formatDA } from "@/utils/format";
import { alnumKey } from "@/utils/text";

const invoiceKey = (value: string): string => alnumKey(value).replace(/^(FACTURE|FACT|FAC|N)+/, "");

function obj(value: Prisma.JsonValue | undefined): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function str(value: unknown): string {
  return typeof value === "string" ? value : value === null || value === undefined ? "" : String(value);
}

/** Relit une facture émise (format de l'ancienne version, conservé tel quel dans `payload`). */
export function draftFromPayload(payload: Prisma.JsonValue): BillingDraft {
  const p = obj(payload);
  const cli = obj(p.cli as Prisma.JsonValue);
  const rows = Array.isArray(p.rows)
    ? p.rows.map((row) => Object.fromEntries(Object.entries(obj(row as Prisma.JsonValue)).map(([key, value]) => [key, typeof value === "boolean" ? (value ? "1" : "") : str(value)])) as BillingRow)
    : [{}];
  const details = obj(p.details as Prisma.JsonValue);
  const bdg = str(p.bdgType);
  return {
    preset: str(p.preset) || "a_hono",
    client: str(p.client) || "AUTRE",
    cli: { nom: str(cli.nom), adresse: str(cli.adresse), tel: str(cli.tel), rc: str(cli.rc), nif: str(cli.nif), nis: str(cli.nis), ai: str(cli.ai) },
    num: str(p.num),
    num2: str(p.num2),
    date: str(p.date) || todayIso(),
    objet: str(p.objet),
    per: /^\d{4}-\d{2}$/.test(str(p.per)) ? str(p.per) : "",
    perTxt: str(p.perTxt),
    succ: str(p.succ),
    bc: str(p.bc),
    origine: str(p.origine),
    destination: str(p.destination),
    details: Object.fromEntries(Object.entries(details).map(([key, value]) => [key, str(value)])),
    notes: str(p.notes),
    rows: rows.length ? rows : [{}],
    bdgType: bdg === "deb" || bdg === "fra" ? bdg : "pair",
    caarProd: str(p.caarProd),
    fromPrev: "",
    emAi: str(p.emAi),
  };
}

async function clientDefaults(client: string): Promise<BillingClientInfo> {
  const base = CLIENTS[client] ?? CLIENTS.AUTRE;
  const setting = await db.setting.findUnique({ where: { key: "facturation" } });
  const saved = obj(obj(setting?.value as Prisma.JsonValue).clients as Prisma.JsonValue)[client];
  const custom = obj(saved as Prisma.JsonValue);
  return {
    nom: str(custom.nom) || base?.nom || "",
    adresse: str(custom.adresse) || base?.adresse || "",
    tel: str(custom.tel) || base?.tel || "",
    rc: str(custom.rc) || base?.rc || "",
    nif: str(custom.nif) || base?.nif || "",
    nis: str(custom.nis) || base?.nis || "",
    ai: str(custom.ai) || base?.ai || "",
  };
}

async function usedNumbers(): Promise<string[]> {
  const [invoices, issued] = await Promise.all([
    db.invoice.findMany({ where: { sens: "CREDIT", numero: { not: "" } }, select: { numero: true, categorie: true, extra: true } }),
    db.issuedInvoice.findMany({ select: { num: true, payload: true } }),
  ]);
  const out: string[] = [];
  for (const invoice of invoices) {
    out.push(invoice.numero);
    const extra = readExtra(invoice.extra);
    if (extra.factureDebours) out.push(extra.factureDebours);
    if (extra.factureFrais) out.push(extra.factureFrais);
  }
  for (const doc of issued) {
    out.push(doc.num);
    const num2 = str(obj(doc.payload).num2);
    if (num2) out.push(num2);
  }
  return out.filter(Boolean);
}

/** Numéros proposés pour un préréglage (numérotation continue, comme dans l'ancienne version). */
async function proposeNumbers(presetId: string, client: string, bdgType: BillingDraft["bdgType"], date: string): Promise<{ num: string; num2: string }> {
  const preset = presetById(presetId);
  const year = Number(date.slice(0, 4));
  const used = await usedNumbers();
  if (preset.m === "bdggam") return { num: nextGamAbNumber(year, used), num2: "" };
  if (preset.m === "bdgpair") {
    const [first, second] = client === "TRUST" ? nextTrustBdgNumbers(year, used) : nextCaatBdgNumbers(year, used.filter((value) => !/TRUST/i.test(value)));
    if (bdgType === "fra") return { num: "", num2: first };
    return { num: first, num2: bdgType === "pair" ? second : "" };
  }
  return { num: nextClientNumber((CLIENTS[client] ?? CLIENTS.AUTRE)?.prefix ?? "FA26-", year, used), num2: "" };
}

/**
 * Prépare une nouvelle facture : numéros proposés, coordonnées du client, période du mois précédent,
 * lignes reprises de la dernière facture du même modèle (montants vidés). Possibilités : dupliquer une facture,
 * ou partir d'une production CAAR contrôlée (une ligne par agence).
 */
export async function prepareDraft(actor: AuthUser, input: PrepareBillingInput): Promise<ActionResult<BillingDraft>> {
  const result = await prepareDraftBase(actor, input);
  if (!result.success) return result;
  return ok({ ...result.data, emAi: result.data.emAi || (await getControlSettings()).articleImposition });
}

async function prepareDraftBase(actor: AuthUser, input: PrepareBillingInput): Promise<ActionResult<BillingDraft>> {
  const guard = requireAccess(actor, "FACT");
  if (!guard.success) return guard;
  const today = todayIso();
  const previousMonth = shiftIsoDate(`${today.slice(0, 7)}-01`, -1).slice(0, 7);
  if (input.duplicateOf) {
    const doc = await db.issuedInvoice.findUnique({ where: { id: input.duplicateOf } });
    if (!doc) return fail("Facture à dupliquer introuvable.", "NOT_FOUND");
    const draft = draftFromPayload(doc.payload);
    const preset = presetById(draft.preset);
    const numbers = await proposeNumbers(draft.preset, draft.client, draft.bdgType, today);
    const model = MODELS[preset.m];
    return ok({
      ...draft,
      ...numbers,
      date: today,
      per: preset.m === "bdgpair" || preset.m === "bdggam" ? previousMonth : draft.per,
      perTxt: preset.m === "bdgpair" || preset.m === "bdggam" ? periodLabel(previousMonth) : draft.perTxt,
      rows: preset.m === "bdggam" ? [{}] : draft.rows.map((row) => (model && preset.m === "bdgpair" ? { ...row, nb: "", mt: "" } : row)),
      caarProd: "",
      fromPrev: doc.num,
    });
  }
  const preset = presetById(input.preset);
  const client = input.client && CLIENTS[input.client] ? input.client : preset.c;
  const bdgType = input.bdgType ?? "pair";
  const numbers = await proposeNumbers(preset.id, client, bdgType, today);
  let rows = presetRows(preset);
  let notes = preset.notes ?? "";
  let succ = "";
  let fromPrev = "";
  let cli = await clientDefaults(client);
  if (preset.m !== "bdgpair" && preset.m !== "bdggam") {
    const previous = await db.issuedInvoice.findFirst({ where: { payload: { path: ["preset"], equals: preset.id } }, orderBy: { date: "desc" } });
    if (previous) {
      const draft = draftFromPayload(previous.payload);
      rows = draft.rows.map((row) => ({ ...row }));
      notes = draft.notes || notes;
      succ = draft.succ;
      cli = { ...cli, ...Object.fromEntries(Object.entries(draft.cli).filter(([, value]) => value)) };
      fromPrev = previous.num;
      if (!["mens", "qte"].includes(preset.m)) {
        const model = MODELS[preset.m];
        for (const row of rows) for (const col of model?.cols ?? []) if ((col.t === "money" && !col.calc && !col.keep) || col.clear) row[col.k] = "";
      }
    }
  }
  if (preset.m === "hono" && !/refact/i.test(preset.id + preset.lbl)) {
    const label = periodLabel(previousMonth);
    for (const row of rows) row.per = label.charAt(0) + label.slice(1).toLowerCase();
  }
  if (preset.m === "mens" && rows[1]) {
    rows[1].des = `Mensualité ${previousMonth.slice(5)}/12`;
    rows[1].per = periodLabel(previousMonth);
  }
  let caarProd = "";
  if (input.caarId) {
    const production = await db.caarProduction.findUnique({ where: { id: input.caarId } });
    if (production) {
      const payload = obj(production.payload);
      const tcd = Array.isArray(payload.tcd) ? payload.tcd : [];
      rows = tcd.map((entry) => (Array.isArray(entry) ? { ag: str(entry[0]), prime: str(entry[2]) } : { ag: "", prime: "" }));
      succ = BRANCHES.CAAR?.find((branch) => branch.toUpperCase().startsWith(production.succursale.toUpperCase().slice(0, 5))) ?? production.succursale;
      caarProd = production.id;
      const month = `${production.annee}-${String(production.mois).padStart(2, "0")}`;
      return ok({ preset: "r_succ", client: "CAAR", cli: await clientDefaults("CAAR"), ...(await proposeNumbers("r_succ", "CAAR", "pair", today)), date: today, objet: "Assistance Routière", per: month, perTxt: periodLabel(month), succ, bc: "", origine: "", destination: "", details: {}, notes: "", rows: rows.length ? rows : [{}], bdgType: "pair", caarProd, fromPrev: "" });
    }
  }
  return ok({
    preset: preset.id,
    client,
    cli,
    ...numbers,
    date: today,
    objet: preset.objet ?? "",
    per: previousMonth,
    perTxt: periodLabel(previousMonth),
    succ,
    bc: "",
    origine: "",
    destination: "",
    details: {},
    notes,
    rows,
    bdgType,
    caarProd,
    fromPrev,
  });
}

/** Factures émises (les plus récentes d'abord) avec l'état de la ligne au suivi. */
export async function listIssued(actor: AuthUser, filter: "all" | "bdg" | "gam" = "all"): Promise<ActionResult<IssuedInvoiceDTO[]>> {
  const guard = requireAccess(actor, filter === "all" ? "FACT" : "BDG");
  if (!guard.success) return guard;
  const docs = await db.issuedInvoice.findMany({ orderBy: [{ date: "desc" }, { num: "desc" }], take: 500 });
  const legacyIds = docs.map((doc) => doc.invoiceLegacyId).filter((id): id is string => Boolean(id));
  const invoices = legacyIds.length ? await db.invoice.findMany({ where: { legacyId: { in: legacyIds } }, select: { id: true, legacyId: true, status: true } }) : [];
  const byLegacy = new Map(invoices.map((invoice) => [invoice.legacyId, invoice]));
  return ok(
    docs
      .map((doc) => {
        const payload = obj(doc.payload);
        const preset = presetById(str(payload.preset));
        const invoice = doc.invoiceLegacyId ? byLegacy.get(doc.invoiceLegacyId) : undefined;
        return {
          id: doc.id,
          num: doc.num,
          num2: str(payload.num2),
          client: doc.client,
          clientLabel: CLIENT_LABELS[doc.client] ?? doc.client,
          date: toIsoDate(doc.date),
          objet: doc.objet,
          presetLabel: preset.lbl,
          perTxt: str(payload.perTxt),
          ttc: decimalToNumber(doc.ttc),
          invoiceId: invoice?.id ?? null,
          invoiceStatus: invoice?.status ?? null,
          rectifications: Number(payload.rectifiee ?? 0) || 0,
          presetModel: preset.m,
          presetId: preset.id,
        };
      })
      .filter((doc) => (filter === "bdg" ? doc.presetModel === "bdgpair" : filter === "gam" ? doc.presetModel === "bdggam" : true))
      .map(({ presetModel: _model, presetId: _id, ...rest }) => rest),
  );
}

/** Facture émise complète (pour l'affichage, l'impression et la rectification). */
export async function getIssued(actor: AuthUser, id: string): Promise<ActionResult<{ id: string; draft: BillingDraft; canEdit: boolean; isAdmin: boolean; versions: number }>> {
  const guard = requireAccess(actor, "FACT");
  if (!guard.success) return guard;
  const doc = await db.issuedInvoice.findUnique({ where: { id } });
  if (!doc) return fail("Facture introuvable.", "NOT_FOUND");
  return ok({ id: doc.id, draft: draftFromPayload(doc.payload), canEdit: can(actor, "FACT", "EDIT"), isAdmin: actor.isAdmin, versions: Number(obj(doc.payload).rectifiee ?? 0) || 0 });
}

function bdgClient(draft: BillingDraft): { cat: string; tiers: string; label: string } {
  return draft.client === "TRUST" ? { cat: "Trust BDG", tiers: "TRUST ASSURANCE", label: "Trust BDG" } : { cat: "BDG CAAT", tiers: `CAAT ${draft.succ}`, label: "BDG CAAT" };
}

/**
 * Enregistre une facture : elle s'ajoute aux factures clients (Crédit) en attente de paiement.
 * Facture BDG : une seule ligne au suivi avec la répartition débours / frais de gestion (2 n° de facture).
 * Une facture déjà émise ne peut être rectifiée que par un administrateur, avec un motif (version conservée).
 */
export async function saveDraft(actor: AuthUser, input: SaveBillingInput): Promise<ActionResult<{ id: string; ttc: number }>> {
  const guard = requireAccess(actor, "FACT", "EDIT");
  if (!guard.success) return guard;
  const draft: BillingDraft = { ...input.draft, rows: input.draft.rows as BillingRow[], emAi: input.draft.emAi || (await getControlSettings()).articleImposition };
  const preset = presetById(draft.preset);
  const { totals } = computeBilling(draft);
  const isBdg = preset.m === "bdgpair";
  if (!draft.num.trim() && !(isBdg && draft.bdgType === "fra")) return fail("Indiquez le n° de facture.", "VALIDATION");
  if (isBdg && draft.bdgType !== "deb" && !draft.num2.trim()) return fail("Indiquez le n° de la facture de frais de gestion.", "VALIDATION");
  if (isBdg && preset.succ && !draft.succ) return fail("Choisissez la succursale.", "VALIDATION");
  if (!(totals.ttc > 0)) return fail("Le total de la facture est nul : vérifiez les montants.", "VALIDATION");
  if (!draft.cli.nom || !draft.cli.nif) return fail("Coordonnées du client incomplètes (raison sociale et NIF obligatoires).", "VALIDATION");
  const existingDoc = input.issuedId ? await db.issuedInvoice.findUnique({ where: { id: input.issuedId } }) : null;
  if (input.issuedId && !existingDoc) return fail("Facture introuvable.", "NOT_FOUND");
  if (existingDoc && !actor.isAdmin) return fail("Facture émise : seul un administrateur peut la rectifier.", "FORBIDDEN");
  if (existingDoc && !input.motif) return fail("Indiquez le motif de la rectification.", "VALIDATION");
  const numbers = [isBdg && draft.bdgType === "fra" ? "" : draft.num, isBdg && draft.bdgType !== "deb" ? draft.num2 : ""].filter(Boolean);
  const keys = numbers.map(invoiceKey);
  const client = CLIENTS[draft.client] ?? CLIENTS.AUTRE;
  try {
    const duplicates = await db.invoice.findMany({ where: { sens: "CREDIT", OR: numbers.map((value) => ({ numero: { contains: value.slice(-6), mode: "insensitive" as const } })) }, select: { legacyId: true, numero: true, extra: true } });
    const conflict = duplicates.find((invoice) => {
      if (existingDoc?.invoiceLegacyId === invoice.legacyId) return false;
      const extra = readExtra(invoice.extra);
      return [invoice.numero, extra.factureDebours ?? "", extra.factureFrais ?? ""].some((value) => value && keys.includes(invoiceKey(value)));
    });
    if (conflict && !existingDoc) return fail(`Le n° ${conflict.numero} existe déjà dans le suivi.`, "CONFLICT");

    const currentInvoice = existingDoc?.invoiceLegacyId ? await db.invoice.findUnique({ where: { legacyId: existingDoc.invoiceLegacyId } }) : null;
    let invoiceData: Omit<Prisma.InvoiceUncheckedCreateInput, "legacyId">;
    if (isBdg) {
      const bc = bdgClient(draft);
      const perLabel = draft.perTxt.charAt(0).toUpperCase() + draft.perTxt.slice(1).toLowerCase();
      const debNum = draft.bdgType !== "fra" ? draft.num : (readExtra(currentInvoice?.extra ?? {}).factureDebours ?? "");
      const fraNum = draft.bdgType !== "deb" ? draft.num2 : (readExtra(currentInvoice?.extra ?? {}).factureFrais ?? "");
      const m1 = debNum.match(/(\d+)\s*BDG/i);
      const m2 = fraNum.match(/(\d+)\s*BDG/i);
      const short = debNum && fraNum ? (draft.client !== "TRUST" && m1?.[1] && m2?.[1] ? `CAAT${draft.date.slice(2, 4)}-${m1[1]}&${m2[1]}BDG` : `${debNum} & ${fraNum}`) : debNum || fraNum;
      const dossiers = draft.rows.reduce((sum, row) => sum + (num(row.nb) || 0), 0);
      const debours = draft.bdgType !== "fra" ? (totals.deb?.ttc ?? 0) : decimalToNumber(currentInvoice?.debours ?? null) ?? 0;
      const frais = draft.bdgType !== "deb" ? (totals.fra?.ttc ?? 0) : decimalToNumber(currentInvoice?.frais ?? null) ?? 0;
      invoiceData = {
        sens: "CREDIT",
        status: currentInvoice?.status ?? "EN_ATTENTE",
        categorie: bc.cat,
        tiers: bc.tiers,
        numero: short,
        libelle:
          draft.client === "TRUST"
            ? `SINISTRE BDG ${draft.perTxt.toUpperCase()}/TRUST – ${dossiers} dossier${dossiers > 1 ? "s" : ""} (frais de gestion ${formatDA(num(draft.rows[0]?.pu) || 800)} HT / dossier)`
            : `SINISTRE BDG ${draft.perTxt.toUpperCase()}/CAAT-Succursale-${draft.succ.toUpperCase()}`,
        montant: r2(debours + frais),
        debours,
        frais,
        dateFacture: fromIsoDate(draft.date),
        annee: Number(draft.date.slice(0, 4)),
        nature: "Production BDG",
        classe: 7,
        periode: perLabel,
        succursale: draft.client === "TRUST" ? "" : `Succursale ${draft.succ}`,
        origine: "facturation",
        extra: writeExtra({ ...readExtra(currentInvoice?.extra ?? {}), factureDebours: debNum, factureFrais: fraNum, deboursHT: totals.deb?.ht ?? 0, fraisHT: totals.fra?.ht ?? 0 }),
        createdById: currentInvoice?.createdById ?? actor.id,
        updatedById: actor.id,
      };
    } else {
      invoiceData = {
        sens: "CREDIT",
        status: currentInvoice?.status ?? "EN_ATTENTE",
        categorie: preset.cat || client?.cat || draft.cli.nom,
        tiers: `${client?.tiers || draft.cli.nom}${draft.succ && draft.client === "CAAR" ? ` ${draft.succ.toUpperCase()}` : draft.succ && draft.client === "CAAT" ? ` ${draft.succ}` : ""}`,
        numero: draft.num,
        libelle: trackingLabel(preset, draft),
        montant: totals.ttc,
        dateFacture: fromIsoDate(draft.date),
        annee: Number(draft.date.slice(0, 4)),
        nature: preset.nature ?? "Production Assistance",
        classe: 7,
        periode: draft.per,
        succursale: draft.succ && draft.succ !== "Direction" ? `Succursale ${draft.succ}` : "",
        origine: "facturation",
        createdById: currentInvoice?.createdById ?? actor.id,
        updatedById: actor.id,
      };
    }
    const payloadBase: Record<string, unknown> = {
      ...draft,
      ht: totals.ht,
      tva: totals.tva,
      ttc: totals.ttc,
      lettres: amountInWords(isBdg && draft.bdgType === "fra" ? (totals.fra?.ttc ?? totals.ttc) : isBdg ? (totals.deb?.ttc ?? totals.ttc) : totals.ttc),
      ...(isBdg ? { lettres2: amountInWords(totals.fra?.ttc ?? 0) } : {}),
      maj: { le: new Date().toISOString(), nom: actor.name, par: actor.id },
    };
    delete payloadBase.fromPrev;
    if (existingDoc) {
      const previous = obj(existingDoc.payload);
      const versions = Array.isArray(previous.versions) ? previous.versions : [];
      payloadBase.versions = [...versions, { num: existingDoc.num, num2: str(previous.num2), ttc: decimalToNumber(existingDoc.ttc), date: toIsoDate(existingDoc.date), rows: previous.rows ?? [], motif: input.motif }].slice(-10);
      payloadBase.rectifiee = (Number(previous.rectifiee ?? 0) || 0) + 1;
      payloadBase.cree = previous.cree;
    } else {
      payloadBase.cree = payloadBase.maj;
    }
    const result = await db.$transaction(async (tx) => {
      let legacyId = currentInvoice?.legacyId ?? "";
      if (currentInvoice) {
        await tx.invoice.update({ where: { id: currentInvoice.id }, data: { ...invoiceData, status: currentInvoice.status, dateOperation: currentInvoice.dateOperation, mode: currentInvoice.mode, cheque: currentInvoice.cheque, banque: currentInvoice.banque } });
      } else {
        legacyId = `fx-${crypto.randomUUID()}`;
        await tx.invoice.create({ data: { ...invoiceData, legacyId } });
      }
      const docData = {
        num: draft.num || draft.num2,
        client: draft.client,
        date: fromIsoDate(draft.date),
        ht: totals.ht,
        tva: totals.tva,
        ttc: totals.ttc,
        objet: draft.objet,
        invoiceLegacyId: legacyId,
        payload: payloadBase as Prisma.InputJsonObject,
      };
      const doc = existingDoc
        ? await tx.issuedInvoice.update({ where: { id: existingDoc.id }, data: docData })
        : await tx.issuedInvoice.create({ data: { ...docData, legacyId: `fx-${crypto.randomUUID()}` } });
      if (draft.caarProd) {
        const production = await tx.caarProduction.findUnique({ where: { id: draft.caarProd } });
        if (production) {
          await tx.caarProduction.update({
            where: { id: production.id },
            data: { status: "facture", payload: { ...obj(production.payload), factureId: legacyId, factureNum: draft.num, factureTTC: totals.ttc, factureDate: draft.date } as Prisma.InputJsonObject },
          });
        }
      }
      return doc;
    });
    await logAction(
      actor,
      existingDoc ? "Facture rectifiée" : "Facture établie",
      `${numbers.join(" / ")} – ${CLIENT_LABELS[draft.client] ?? draft.client} – ${formatDA(totals.ttc)}${existingDoc ? ` – motif : ${input.motif}` : ""}`,
    );
    return ok({ id: result.id, ttc: totals.ttc });
  } catch (error) {
    console.error("[facturation] enregistrement :", error);
    return fail("La facture n'a pas pu être enregistrée.", "DATABASE");
  }
}

/** Liste des préréglages d'un client (pour l'éditeur). */
export function presetsOf(client: string): Array<{ id: string; lbl: string }> {
  return PRESETS.filter((preset) => preset.c === client).map((preset) => ({ id: preset.id, lbl: preset.lbl }));
}
