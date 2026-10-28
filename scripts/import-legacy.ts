/**
 * Import des données de l'ancienne version d'AssistPay (fichier data/db.json du serveur Node,
 * ou export de la base partagée) vers PostgreSQL.
 *
 *   npm run db:import -- chemin/vers/db.json [--comptes chemin/vers/comptes.json] [--rapport rapport-import.json]
 *
 * - Chaque document est validé par un schéma Zod ; ce qui est invalide est écarté et listé dans le rapport.
 * - L'import est rejouable : chaque ligne est retrouvée par son identifiant d'origine (legacyId) et mise à jour.
 * - Factures : les archives (lot1…lot3) sont importées puis les factures courantes de même identifiant les remplacent.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { PROFILE_KEYS, type AccessLevelKey, type ModuleKey, type ProfileKey } from "@/features/access/types";
import { MODULE_KEYS } from "@/features/access/types";
import { isPayrollInvoice } from "@/features/invoices/services/invoice-rules";
import { createScriptClient } from "./script-db";

/* ------------------------------------------------------------------ arguments */

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index > -1 ? process.argv[index + 1] : undefined;
}

const sourcePath = process.argv.slice(2).find((arg, index, all) => !arg.startsWith("--") && !(all[index - 1] ?? "").startsWith("--"));
if (!sourcePath) {
  console.error("Usage : npm run db:import -- chemin/vers/db.json [--comptes comptes.json] [--rapport rapport.json]");
  process.exit(1);
}
const comptesPath = argValue("--comptes");
const reportPath = argValue("--rapport") ?? "rapport-import.json";

/* ------------------------------------------------------------------ outils de conversion */

const str = z.preprocess((value) => (value === null || value === undefined ? "" : String(value)), z.string()).transform((value) => value.trim());
const num = z.preprocess((value) => {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") return Number(value.replace(/\s/g, "").replace(",", "."));
  return Number.NaN;
}, z.number().finite());
const optNum = z.preprocess((value) => (value === null || value === undefined || value === "" ? null : value), num.nullable());
const optInt = optNum.transform((value) => (value === null ? null : Math.trunc(value)));
const isoDay = str.transform((value) => (/^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : ""));
const strList = z.preprocess((value) => (Array.isArray(value) ? value.map((item) => String(item)) : []), z.array(z.string()));
const record = z.record(z.unknown());

function day(value: string): Date | null {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function money(value: number): number {
  return Math.round(value * 100) / 100;
}

function rest(source: Record<string, unknown>, known: readonly string[]): Prisma.InputJsonObject {
  const extra: Record<string, Prisma.InputJsonValue> = {};
  for (const [key, value] of Object.entries(source)) {
    if (!known.includes(key) && value !== undefined && value !== null) extra[key] = value as Prisma.InputJsonValue;
  }
  return extra;
}

function json(value: unknown): Prisma.InputJsonValue {
  return (value ?? {}) as Prisma.InputJsonValue;
}

/* ------------------------------------------------------------------ schémas des anciennes collections */

const invoiceRow = z.object({
  sens: z.enum(["Crédit", "Débit"]),
  etat: str,
  categorie: str,
  tiers: str,
  facture: str,
  libelle: str,
  montant: num,
  montantGlobal: optNum.optional(),
  date: isoDay,
  dateFacture: isoDay.optional(),
  annee: optInt.optional(),
  type: str,
  cheque: str,
  banque: str,
  nature: str,
  classe: optInt.optional(),
  succursale: str.optional(),
  periode: str.optional(),
  debours: optNum.optional(),
  frais: optNum.optional(),
  dp: strList.optional(),
  origine: str.optional(),
  ordre: optNum.optional(),
  supprime: z.unknown().optional(),
});
const INVOICE_KNOWN = Object.keys(invoiceRow.shape).concat(["id", "cree", "maj"]);

const statementRow = z.object({
  date: isoDay.refine((value) => value !== "", "date manquante"),
  libelle: str,
  montant: num,
  sens: z.enum(["Crédit", "Débit"]),
  numero: str.optional(),
  type: str.optional(),
  statut: z.enum(["a_traiter", "rapproche", "deja", "ignore", "ajoute"]),
  factures: strList,
  importe: str.optional(),
});

const paymentRequestRow = z.object({
  num: optInt,
  ref: str,
  benef: str,
  adresse: str.optional(),
  date: isoDay.optional(),
  mode: str,
  montant: num,
  nature: str,
  type: str,
  statut: str,
  source: str.optional(),
  pieces: strList.optional(),
  factureIds: strList.optional(),
});

const issuedInvoiceRow = z.object({ num: str, client: str, date: isoDay, ht: num, tva: num, ttc: num, objet: str, factureId: str.optional() });
const caarRow = z.object({ annee: optInt, mois: optInt, succ: str, fichier: str, statut: str });
const caarChunkRow = z.object({ prod: str, k: optInt, rows: z.array(z.unknown()) });
const ribRow = z.object({ code: str, k: str, rib: str.refine((value) => value !== "", "RIB vide"), noms: strList, types: strList, wilaya: str, statut: str, origine: str });
const transferRow = z.object({ ref: str, type: str, annee: optInt, mois: str, fichier: str, d: num, c: num, nb: optInt, statut: str, verdict: str, lines: z.array(z.unknown()) });
const hrRow = z.object({
  date: isoDay,
  annee: optInt,
  mois: str,
  beneficiaire: str,
  libelle: str,
  montant: num,
  sens: str,
  nature: str,
  mode: str,
  banque: str,
  cheque: str,
  classe: optInt,
  ordre: optNum,
  origine: str,
  categorieOrigine: str.optional(),
});
const reminderRow = z.object({ partenaire: str, montant: num, nb: optInt, le: str });
const journalRow = z.object({ action: str, le: str, nom: str, objet: str, par: str });
const userRow = z.object({ email: str, nom: str, prenom: str, profil: str, statut: str, acces: z.record(z.string()).optional() });
const accountRow = z.object({ id: str, email: str, nom: str, role: str, salt: str.optional(), hash: str.optional(), desactive: z.boolean().optional() });

/* ------------------------------------------------------------------ correspondances */

const ETAT: Readonly<Record<string, "EN_ATTENTE" | "REGLE" | "ANNULE">> = { "Reglé": "REGLE", "Réglé": "REGLE", "En attente": "EN_ATTENTE", "Annulé": "ANNULE" };
const STATEMENT: Readonly<Record<string, "A_TRAITER" | "RAPPROCHE" | "DEJA" | "IGNORE" | "AJOUTE">> = {
  a_traiter: "A_TRAITER",
  rapproche: "RAPPROCHE",
  deja: "DEJA",
  ignore: "IGNORE",
  ajoute: "AJOUTE",
};
const PROFILE_BY_LABEL: Readonly<Record<string, ProfileKey>> = {
  Administrateur: "ADMINISTRATEUR",
  Direction: "DIRECTION",
  "Équipe facturation": "EQUIPE_FACTURATION",
  "Chargé de facturation": "CHARGE_FACTURATION",
  Comptable: "COMPTABLE",
  RH: "RH",
  Partenaire: "PARTENAIRE",
};
const LEVEL: Readonly<Record<string, AccessLevelKey>> = { non: "NONE", voir: "VIEW", modif: "EDIT" };

function paymentMode(value: string): "VIREMENT" | "CHEQUE" | "VERSEMENT" | "AUTRE" | null {
  const key = value.toUpperCase();
  if (!key) return null;
  if (key.startsWith("VIR")) return "VIREMENT";
  if (key.startsWith("CHEQ") || key.startsWith("CHÈQ")) return "CHEQUE";
  if (key.startsWith("VRS") || key.startsWith("VERS")) return "VERSEMENT";
  return "AUTRE";
}

function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/);
  const upper = parts.filter((part) => part.length > 1 && part === part.toUpperCase());
  const lower = parts.filter((part) => !upper.includes(part));
  return { firstName: lower.join(" "), lastName: upper.join(" ") };
}

/* ------------------------------------------------------------------ rapport */

interface Report {
  source: string;
  startedAt: string;
  imported: Record<string, number>;
  skipped: Array<{ collection: string; id: string; reason: string }>;
}
const report: Report = { source: resolve(sourcePath), startedAt: new Date().toISOString(), imported: {}, skipped: [] };

function skip(collection: string, id: string, error: z.ZodError | string): void {
  const reason = typeof error === "string" ? error : error.issues.map((issue) => `${issue.path.join(".") || "document"} : ${issue.message}`).join(" ; ");
  report.skipped.push({ collection, id, reason });
}

function count(collection: string, n: number): void {
  report.imported[collection] = (report.imported[collection] ?? 0) + n;
}

async function inBatches<T>(items: T[], size: number, run: (item: T) => Promise<unknown>): Promise<void> {
  for (let index = 0; index < items.length; index += size) {
    await Promise.all(items.slice(index, index + size).map(run));
  }
}

/* ------------------------------------------------------------------ import */

async function main(): Promise<void> {
  const rawFile: unknown = JSON.parse(readFileSync(resolve(sourcePath as string), "utf8"));
  const store = record.parse(rawFile);
  const byCollection = new Map<string, Array<{ id: string; data: Record<string, unknown> }>>();
  for (const [key, value] of Object.entries(store)) {
    const slash = key.lastIndexOf("/");
    if (slash < 0) continue;
    const parsed = record.safeParse(value);
    if (!parsed.success) continue;
    const collection = key.slice(0, slash);
    const list = byCollection.get(collection) ?? [];
    list.push({ id: key.slice(slash + 1), data: parsed.data });
    byCollection.set(collection, list);
  }
  const docs = (collection: string): Array<{ id: string; data: Record<string, unknown> }> => byCollection.get(collection) ?? [];
  const db = createScriptClient();

  try {
    /* ---------- utilisateurs ---------- */
    const accounts = new Map<string, z.infer<typeof accountRow>>();
    if (comptesPath) {
      const list = z.array(z.unknown()).parse(JSON.parse(readFileSync(resolve(comptesPath), "utf8")));
      for (const item of list) {
        const parsed = accountRow.safeParse(item);
        if (parsed.success) accounts.set(parsed.data.id, parsed.data);
        else skip("comptes", "?", parsed.error);
      }
    }
    const userIds = new Set<string>();
    const legacyUsers = docs("utilisateurs");
    const ids = new Set([...legacyUsers.map((doc) => doc.id), ...accounts.keys()]);
    for (const id of ids) {
      const doc = legacyUsers.find((item) => item.id === id);
      const parsed = doc ? userRow.safeParse(doc.data) : null;
      if (parsed && !parsed.success) {
        skip("utilisateurs", id, parsed.error);
        continue;
      }
      const account = accounts.get(id);
      const info = parsed?.data;
      const email = (info?.email || account?.email || "").toLowerCase();
      if (!email) {
        skip("utilisateurs", id, "adresse e-mail manquante");
        continue;
      }
      const profile: ProfileKey =
        (info ? PROFILE_BY_LABEL[info.profil] : undefined) ??
        (account && (account.role === "proprietaire" || account.role === "administrateur") ? "ADMINISTRATEUR" : "CHARGE_FACTURATION");
      const names = info ? { firstName: info.prenom, lastName: info.nom } : splitName(account?.nom ?? "");
      const passwordHash = account?.salt && account.hash ? `scrypt$${account.salt}$${account.hash}` : undefined;
      const active = info ? info.statut !== "inactif" && info.statut !== "desactive" && !account?.desactive : !account?.desactive;
      await db.user.upsert({
        where: { id },
        create: { id, email, ...names, profile, active, passwordHash: passwordHash ?? null },
        update: { email, ...names, profile, active, ...(passwordHash ? { passwordHash } : {}) },
      });
      const overrides: Array<{ module: ModuleKey; level: AccessLevelKey }> = [];
      for (const [key, value] of Object.entries(info?.acces ?? {})) {
        const module = key.toUpperCase();
        const level = LEVEL[value];
        if ((MODULE_KEYS as readonly string[]).includes(module) && level) overrides.push({ module: module as ModuleKey, level });
      }
      if (account?.role === "lecteur") {
        for (const module of MODULE_KEYS) if (!overrides.some((item) => item.module === module)) overrides.push({ module, level: "VIEW" });
      }
      await db.userModuleAccess.deleteMany({ where: { userId: id } });
      if (overrides.length) await db.userModuleAccess.createMany({ data: overrides.map((item) => ({ userId: id, ...item })) });
      userIds.add(id);
      count("utilisateurs", 1);
    }
    if (!PROFILE_KEYS.length) throw new Error("profils manquants");

    /* ---------- factures (archives puis factures courantes) ---------- */
    const invoices = new Map<string, { data: Record<string, unknown>; archived: boolean }>();
    for (const lot of docs("archives")) {
      const rows = z.array(record).safeParse(lot.data.rows);
      if (!rows.success) {
        skip("archives", lot.id, rows.error);
        continue;
      }
      for (const row of rows.data) {
        const id = str.parse(row.id);
        if (id) invoices.set(id, { data: row, archived: true });
      }
    }
    for (const doc of docs("factures")) invoices.set(doc.id, { data: doc.data, archived: false });

    const invoiceWrites: Array<{ legacyId: string; data: Omit<Prisma.InvoiceUncheckedCreateInput, "legacyId"> }> = [];
    for (const [legacyId, item] of invoices) {
      const parsed = invoiceRow.safeParse(item.data);
      if (!parsed.success) {
        skip(item.archived ? "archives" : "factures", legacyId, parsed.error);
        continue;
      }
      const row = parsed.data;
      if (row.supprime) {
        skip("factures", legacyId, "ligne supprimée dans l'ancienne version");
        continue;
      }
      const dateFacture = row.dateFacture ?? "";
      invoiceWrites.push({
        legacyId,
        data: {
          sens: row.sens === "Crédit" ? "CREDIT" : "DEBIT",
          status: ETAT[row.etat] ?? "EN_ATTENTE",
          categorie: row.categorie,
          tiers: row.tiers,
          numero: row.facture,
          libelle: row.libelle,
          montant: money(row.montant),
          montantGlobal: row.montantGlobal ?? null,
          dateOperation: day(row.date),
          dateFacture: day(dateFacture),
          annee: row.annee ?? (dateFacture || row.date ? Number((dateFacture || row.date).slice(0, 4)) : null),
          mode: paymentMode(row.type),
          cheque: row.cheque,
          banque: row.banque,
          nature: row.nature,
          classe: row.classe ?? null,
          succursale: row.succursale ?? "",
          periode: row.periode ?? "",
          debours: row.debours ?? null,
          frais: row.frais ?? null,
          paymentRefs: row.dp ?? [],
          origine: row.origine ?? "",
          ordre: row.ordre ?? null,
          archived: item.archived,
          payroll: isPayrollInvoice(row.categorie, row.nature),
          extra: rest(item.data, INVOICE_KNOWN),
        },
      });
    }
    await inBatches(invoiceWrites, 50, (item) =>
      db.invoice.upsert({ where: { legacyId: item.legacyId }, create: { legacyId: item.legacyId, ...item.data }, update: item.data }),
    );
    count("factures", invoiceWrites.length);

    /* ---------- relevé bancaire ---------- */
    const statements: Array<{ legacyId: string; data: Omit<Prisma.BankStatementLineCreateInput, "legacyId"> }> = [];
    for (const doc of docs("releve")) {
      const parsed = statementRow.safeParse(doc.data);
      if (!parsed.success) {
        skip("releve", doc.id, parsed.error);
        continue;
      }
      const row = parsed.data;
      const date = day(row.date);
      if (!date) {
        skip("releve", doc.id, "date invalide");
        continue;
      }
      statements.push({
        legacyId: doc.id,
        data: {
          date,
          libelle: row.libelle,
          montant: money(row.montant),
          sens: row.sens === "Crédit" ? "CREDIT" : "DEBIT",
          numero: row.numero ?? "",
          type: row.type ?? "",
          status: STATEMENT[row.statut] ?? "A_TRAITER",
          invoiceRefs: row.factures,
          importedAt: row.importe && !Number.isNaN(Date.parse(row.importe)) ? new Date(row.importe) : new Date(),
          extra: rest(doc.data, Object.keys(statementRow.shape)),
        },
      });
    }
    await inBatches(statements, 50, (item) =>
      db.bankStatementLine.upsert({ where: { legacyId: item.legacyId }, create: { legacyId: item.legacyId, ...item.data }, update: item.data }),
    );
    count("releve", statements.length);

    /* ---------- demandes de paiement (courantes + archives Excel) ---------- */
    const requests: Array<{ legacyId: string; data: Omit<Prisma.PaymentRequestCreateInput, "legacyId"> }> = [];
    const pushRequest = (legacyId: string, raw: Record<string, unknown>, archived: boolean): void => {
      const parsed = paymentRequestRow.safeParse(raw);
      if (!parsed.success) {
        skip(archived ? "dparchives" : "dp", legacyId, parsed.error);
        return;
      }
      const row = parsed.data;
      if (row.num === null) {
        skip(archived ? "dparchives" : "dp", legacyId, "numéro de demande manquant");
        return;
      }
      requests.push({
        legacyId,
        data: {
          num: row.num,
          ref: row.ref,
          beneficiaire: row.benef,
          adresse: row.adresse ?? "",
          date: day(row.date ?? ""),
          mode: row.mode,
          montant: money(row.montant),
          nature: row.nature,
          produit: row.type,
          status: row.statut,
          source: row.source ?? "",
          pieces: row.pieces ?? [],
          invoiceIds: row.factureIds ?? [],
          archived,
          extra: rest(raw, [...Object.keys(paymentRequestRow.shape), "id"]),
        },
      });
    };
    const currentNums = new Set(docs("dp").map((doc) => doc.id));
    for (const doc of docs("dp")) pushRequest(`dp-${doc.id}`, doc.data, false);
    for (const lot of docs("dparchives")) {
      const rows = z.array(record).safeParse(lot.data.rows);
      if (!rows.success) {
        skip("dparchives", lot.id, rows.error);
        continue;
      }
      for (const row of rows.data) {
        const id = str.parse(row.id);
        const numKey = String(Number(id));
        if (!id || currentNums.has(numKey) || currentNums.has(id)) continue;
        pushRequest(`dpa-${id}`, row, true);
      }
    }
    await inBatches(requests, 50, (item) =>
      db.paymentRequest.upsert({ where: { legacyId: item.legacyId }, create: { legacyId: item.legacyId, ...item.data }, update: item.data }),
    );
    count("demandes de paiement", requests.length);

    /* ---------- factures émises ---------- */
    for (const doc of docs("facturation")) {
      const parsed = issuedInvoiceRow.safeParse(doc.data);
      if (!parsed.success) {
        skip("facturation", doc.id, parsed.error);
        continue;
      }
      const row = parsed.data;
      const data = {
        num: row.num,
        client: row.client,
        date: day(row.date),
        ht: money(row.ht),
        tva: money(row.tva),
        ttc: money(row.ttc),
        objet: row.objet,
        invoiceLegacyId: row.factureId || null,
        payload: json(doc.data),
      };
      await db.issuedInvoice.upsert({ where: { legacyId: doc.id }, create: { legacyId: doc.id, ...data }, update: data });
      count("factures émises", 1);
    }

    /* ---------- production CAAR ---------- */
    const chunks = docs("caarprodrows");
    for (const doc of docs("caarprod")) {
      const parsed = caarRow.safeParse(doc.data);
      if (!parsed.success || parsed.data.annee === null || parsed.data.mois === null) {
        skip("caarprod", doc.id, parsed.success ? "année ou mois manquant" : parsed.error);
        continue;
      }
      const row = parsed.data;
      const data = { annee: row.annee ?? 0, mois: row.mois ?? 0, succursale: row.succ, fichier: row.fichier, status: row.statut, payload: json(doc.data) };
      const production = await db.caarProduction.upsert({ where: { legacyId: doc.id }, create: { legacyId: doc.id, ...data }, update: data });
      await db.caarProductionChunk.deleteMany({ where: { productionId: production.id } });
      const own = chunks.flatMap((chunk) => {
        const parsedChunk = caarChunkRow.safeParse(chunk.data);
        if (!parsedChunk.success) {
          skip("caarprodrows", chunk.id, parsedChunk.error);
          return [];
        }
        return parsedChunk.data.prod === doc.id && parsedChunk.data.k !== null ? [{ k: parsedChunk.data.k, rows: json(parsedChunk.data.rows) }] : [];
      });
      if (own.length) await db.caarProductionChunk.createMany({ data: own.map((chunk) => ({ productionId: production.id, ...chunk })) });
      count("production CAAR", 1);
      count("production CAAR (blocs de lignes)", own.length);
    }

    /* ---------- RIB prestataires ---------- */
    const ribs: Array<{ legacyId: string; data: Omit<Prisma.ProviderRibCreateInput, "legacyId"> }> = [];
    for (const doc of docs("virribs")) {
      const parsed = ribRow.safeParse(doc.data);
      if (!parsed.success) {
        skip("virribs", doc.id, parsed.error);
        continue;
      }
      const row = parsed.data;
      ribs.push({
        legacyId: doc.id,
        data: {
          code: row.code,
          key: row.k,
          rib: row.rib,
          noms: row.noms,
          types: row.types,
          wilaya: row.wilaya,
          status: row.statut,
          origine: row.origine,
          extra: rest(doc.data, Object.keys(ribRow.shape)),
        },
      });
    }
    await inBatches(ribs, 50, (item) =>
      db.providerRib.upsert({ where: { legacyId: item.legacyId }, create: { legacyId: item.legacyId, ...item.data }, update: item.data }),
    );
    count("RIB prestataires", ribs.length);

    /* ---------- fichiers de virements ---------- */
    for (const doc of docs("virenvois")) {
      const parsed = transferRow.safeParse(doc.data);
      if (!parsed.success) {
        skip("virenvois", doc.id, parsed.error);
        continue;
      }
      const row = parsed.data;
      const data = {
        ref: row.ref,
        type: row.type,
        annee: row.annee,
        mois: row.mois,
        fichier: row.fichier,
        debit: money(row.d),
        credit: money(row.c),
        nb: row.nb ?? 0,
        status: row.statut,
        verdict: row.verdict,
        lines: json(row.lines),
        extra: rest(doc.data, Object.keys(transferRow.shape)),
      };
      await db.transferBatch.upsert({ where: { legacyId: doc.id }, create: { legacyId: doc.id, ...data }, update: data });
      count("fichiers de virements", 1);
    }

    /* ---------- RH ---------- */
    const hr: Array<{ legacyId: string; data: Omit<Prisma.HrEntryCreateInput, "legacyId"> }> = [];
    for (const doc of docs("rh")) {
      const parsed = hrRow.safeParse(doc.data);
      if (!parsed.success) {
        skip("rh", doc.id, parsed.error);
        continue;
      }
      const row = parsed.data;
      hr.push({
        legacyId: doc.id,
        data: {
          date: day(row.date),
          annee: row.annee,
          mois: row.mois,
          beneficiaire: row.beneficiaire,
          libelle: row.libelle,
          montant: money(row.montant),
          sens: row.sens.toLowerCase().startsWith("paiement") ? "PAIEMENT" : "RETOUR",
          nature: row.nature,
          mode: row.mode,
          banque: row.banque,
          cheque: row.cheque,
          classe: row.classe,
          ordre: row.ordre,
          origine: row.origine,
          categorieOrigine: row.categorieOrigine ?? "",
          extra: rest(doc.data, Object.keys(hrRow.shape)),
        },
      });
    }
    await inBatches(hr, 50, (item) => db.hrEntry.upsert({ where: { legacyId: item.legacyId }, create: { legacyId: item.legacyId, ...item.data }, update: item.data }));
    count("RH", hr.length);

    /* ---------- relances ---------- */
    for (const doc of docs("relances")) {
      const parsed = reminderRow.safeParse(doc.data);
      if (!parsed.success || Number.isNaN(Date.parse(parsed.data.le))) {
        skip("relances", doc.id, parsed.success ? "date d'envoi invalide" : parsed.error);
        continue;
      }
      const data = { partenaire: parsed.data.partenaire, montant: money(parsed.data.montant), nb: parsed.data.nb ?? 0, sentAt: new Date(parsed.data.le), payload: json(doc.data) };
      await db.reminder.upsert({ where: { legacyId: doc.id }, create: { legacyId: doc.id, ...data }, update: data });
      count("relances", 1);
    }

    /* ---------- journal ---------- */
    for (const [collection, admin] of [
      ["journal", false],
      ["journaladmin", true],
    ] as const) {
      const entries: Prisma.JournalEntryCreateManyInput[] = [];
      for (const doc of docs(collection)) {
        const parsed = journalRow.safeParse(doc.data);
        if (!parsed.success || Number.isNaN(Date.parse(parsed.data.le))) {
          skip(collection, doc.id, parsed.success ? "date invalide" : parsed.error);
          continue;
        }
        const row = parsed.data;
        entries.push({
          legacyId: `${collection}-${doc.id}`,
          at: new Date(row.le),
          userId: userIds.has(row.par) ? row.par : null,
          userName: row.nom,
          action: row.action,
          objet: row.objet,
          admin,
        });
      }
      const result = await db.journalEntry.createMany({ data: entries, skipDuplicates: true });
      count(collection === "journal" ? "journal" : "journal d'administration", result.count);
    }

    /* ---------- réglages ---------- */
    for (const doc of docs("reglages")) {
      await db.setting.upsert({ where: { key: doc.id }, create: { key: doc.id, value: json(doc.data) }, update: { value: json(doc.data) } });
      count("réglages", 1);
    }
  } finally {
    await db.$disconnect();
  }

  writeFileSync(resolve(reportPath), JSON.stringify(report, null, 2));
  console.log("Import terminé.");
  console.table(report.imported);
  console.log(`${report.skipped.length} élément(s) écarté(s) – détail dans ${resolve(reportPath)}`);
}

main().catch((error: unknown) => {
  console.error("Import interrompu :", error);
  process.exit(1);
});
