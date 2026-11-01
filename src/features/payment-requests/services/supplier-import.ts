import { db } from "@/lib/db";
import { readWorkbook, writeWorkbook, type SheetCell, type SheetData } from "@/lib/spreadsheet";
import type { Prisma } from "@/generated/prisma/client";
import { requireAccess } from "@/features/access/services/access-rules";
import type { AuthUser } from "@/features/access/types";
import { isPayrollInvoice } from "@/features/invoices/services/invoice-rules";
import { logAction } from "@/features/journal/services/journal-service";
import { beneficiaryKey } from "@/features/payment-requests/services/dp-import-parser";
import { createWithNextNumber, productGuesser } from "@/features/payment-requests/services/payment-request-service";
import type { DpProduct } from "@/features/payment-requests/types";
import { fail, ok, type ActionResult } from "@/types";
import { parseLooseAmount, round2 } from "@/utils/amounts";
import { fromIsoDate, parseLooseDate, todayIso } from "@/utils/dates";
import { formatDA, formatDate } from "@/utils/format";
import { upperPlain } from "@/utils/text";

/** Fichier envoyé par le navigateur. */
export interface SupplierFile {
  name: string;
  bytes: Uint8Array;
}

/** Facture fournisseur lue dans le canevas. */
export interface SupplierRow {
  benef: string;
  facture: string;
  dateDoc: string;
  montant: number;
  produit: DpProduct;
  produitDeduit: boolean;
  categorie: string;
  nature: string;
  mode: "VIRMT" | "CHEQUE";
  cheque: string;
  banque: string;
  datePay: string;
  groupe: string;
  adresse: string;
  objet: string;
  rib: string;
}

/** Demande de paiement qui sera créée : une ou plusieurs factures d'un même bénéficiaire. */
export interface SupplierGroup {
  benef: string;
  produit: DpProduct;
  mode: "VIRMT" | "CHEQUE";
  total: number;
  rows: SupplierRow[];
}

/** Aperçu de l'import avant application. */
export interface SupplierPlan {
  groups: SupplierGroup[];
  invoices: number;
  total: number;
  duplicates: Array<{ benef: string; facture: string; montant: number }>;
  errors: string[];
}

type Field = "benef" | "facture" | "dateDoc" | "montant" | "produit" | "categorie" | "nature" | "mode" | "cheque" | "banque" | "datePay" | "groupe" | "adresse" | "objet" | "rib";

const COLUMNS: ReadonlyArray<readonly [Field, readonly string[]]> = [
  ["benef", ["NOM & PRENOM / RAISON SOCIALE", "NOM & PRENOM", "NOM ET PRENOM / RAISON SOCIALE", "NOM ET PRENOM", "NOM PRENOM", "RAISON SOCIALE", "BENEFICIAIRE", "FOURNISSEUR"]],
  ["facture", ["N° FACTURE", "N FACTURE", "NUMERO FACTURE", "FACTURE"]],
  ["dateDoc", ["DATE FACTURE", "DATE DE FACTURE"]],
  ["montant", ["MONTANT TTC", "MONTANT"]],
  ["produit", ["TYPE DE PRESTATAIRE", "TYPE PRESTATAIRE", "PRODUIT"]],
  ["categorie", ["CATEGORIE"]],
  ["nature", ["NATURE DE LA DEPENSE", "NATURE"]],
  ["mode", ["TYPE DE REGLEMENT", "MODE DE REGLEMENT", "MODE"]],
  ["cheque", ["N° DE CHEQUE", "N DE CHEQUE", "CHEQUE"]],
  ["banque", ["BANQUE"]],
  ["datePay", ["DATE DE PAIEMENT"]],
  ["groupe", ["DP COMMUNE", "GROUPE DP", "GROUPE"]],
  ["adresse", ["ADRESSE / WILAYA", "ADRESSE", "WILAYA"]],
  ["objet", ["OBJET", "OBSERVATION"]],
  ["rib", ["RIB", "N° RIB", "N RIB", "RIB BANCAIRE", "COMPTE BANCAIRE"]],
];

const CATEGORY_BY_PRODUCT: Readonly<Record<DpProduct, string>> = {
  "Assistance routière": "Prestataire assistance routière",
  BDG: "Prestataire BDG",
  "Tiers payant": "Prestataire TPA",
  Autre: "Fournisseur",
};

const clean = (value: unknown): string => String(value ?? "").replace(/ /g, " ").replace(/\s+/g, " ").trim();
const norm = (value: unknown): string => upperPlain(clean(value)).replace(/\s*\*\s*$/, "").replace(/\s*\(.*?\)\s*$/, "").trim();
const invoiceKey = (value: string): string => upperPlain(value).replace(/[^A-Z0-9]/g, "").replace(/^(FACTURE|FACT|FAC|N)+/, "");

function productFromText(value: string): DpProduct {
  const text = upperPlain(value);
  if (/BDG|BRIS/.test(text)) return "BDG";
  if (/TIERS|TPA/.test(text)) return "Tiers payant";
  if (/ASSIST|ROUTI|DEPANN/.test(text)) return "Assistance routière";
  return "Autre";
}

function locate(sheets: SheetData[]): { sheet: SheetData; headerRow: number; cols: Record<Field, number> } | null {
  const candidates = sheets.filter((sheet) => sheet.rows.length > 1 && !/MODE D.?EMPLOI/i.test(sheet.name));
  const keys = COLUMNS.flatMap(([, names]) => names);
  let best: { sheet: SheetData; headerRow: number; score: number } | null = null;
  for (const sheet of candidates) {
    for (let index = 0; index < Math.min(sheet.rows.length, 30); index += 1) {
      const score = (sheet.rows[index] ?? []).filter((cell) => {
        const text = norm(cell);
        return text !== "" && keys.some((key) => text === key);
      }).length;
      if (!best || score > best.score) best = { sheet, headerRow: index, score };
    }
  }
  if (!best || best.score < 3) return null;
  const header = (best.sheet.rows[best.headerRow] ?? []).map(norm);
  const cols = Object.fromEntries(COLUMNS.map(([field]) => [field, -1])) as Record<Field, number>;
  const used = new Set<number>();
  for (const [field, names] of COLUMNS) {
    for (const name of names) {
      const found = header.findIndex((cell, index) => !used.has(index) && cell === name);
      if (found >= 0) {
        cols[field] = found;
        used.add(found);
        break;
      }
    }
  }
  return { sheet: best.sheet, headerRow: best.headerRow, cols };
}

function dateCell(cell: SheetCell): string {
  if (cell === null || cell === "") return "";
  if (typeof cell === "string") {
    const match = cell.replace(/ /g, "").trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
    if (match) {
      let day = Number(match[1]);
      let month = Number(match[2]);
      if (month > 12 && day <= 12) [day, month] = [month, day];
      const year = match[3]!.length === 2 ? `20${match[3]}` : match[3]!;
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }
  return parseLooseDate(cell);
}

/** Canevas Excel vierge : une ligne par facture fournisseur déposée. */
export function supplierTemplate(): Uint8Array {
  const header = [
    "Bénéficiaire *",
    "N° facture *",
    "Date facture *",
    "Montant TTC (DA) *",
    "Type de prestataire *",
    "Type de règlement *",
    "Objet (facultatif)",
    "DP commune (facultatif)",
    "RIB (facultatif, 20 chiffres)",
    "Adresse / wilaya (facultatif)",
  ];
  return writeWorkbook([
    {
      name: "Factures fournisseurs",
      widths: [32, 22, 14, 18, 21, 18, 34, 16, 26, 20],
      rows: [
        ["ALLO ASSISTANCE – Recensement des factures fournisseurs déposées"],
        ["Une ligne = une facture. Remplir à partir de la ligne 5 ; la ligne 4 (EXEMPLE) est ignorée. Type de prestataire : Assistance routière, BDG, Tiers payant ou Autre. Type de règlement : Virement ou Chèque."],
        header,
        ["EXEMPLE – SARL SOS GLASS", "FACT 013/2026", "11/07/2026", 2215720.5, "BDG", "Virement", "Sinistre BDG juin 2026", "", "00100291020000092343", "ALGER"],
      ],
    },
    {
      name: "Mode d'emploi",
      widths: [100],
      rows: [
        ["Mode d'emploi"],
        ["À l'import : chaque facture est créée en Débit (en attente) et sa demande de paiement est créée automatiquement, avec la numérotation qui reprend après la dernière demande."],
        ["Le n° de chèque se saisit plus tard dans le suivi (« Marquer réglé ») quand la comptabilité remet le chèque."],
        ["DP commune : le même code sur plusieurs factures d'un même bénéficiaire regroupe ces factures dans une seule demande de paiement."],
        ["Les factures déjà enregistrées (même bénéficiaire, même montant, même n°) sont ignorées."],
      ],
    },
  ]);
}

async function buildPlan(actor: AuthUser, file: SupplierFile): Promise<ActionResult<SupplierPlan>> {
  for (const [module, level] of [["FFOUR", "EDIT"], ["DP", "EDIT"], ["A_IMPORT", "EDIT"]] as const) {
    const guard = requireAccess(actor, module, level);
    if (!guard.success) return guard;
  }
  let sheets: SheetData[];
  try {
    sheets = readWorkbook(file.bytes);
  } catch (error) {
    console.error("[canevas] lecture :", error);
    return fail("Ce fichier n'a pas pu être lu.", "VALIDATION");
  }
  const layout = locate(sheets);
  if (!layout) return fail("Colonnes Bénéficiaire et Montant introuvables : utilisez le canevas (bouton « Télécharger le canevas »).", "VALIDATION");
  const { cols } = layout;
  if (cols.benef < 0 || cols.montant < 0) return fail("Colonnes Bénéficiaire et Montant introuvables : utilisez le canevas.", "VALIDATION");

  const [guess, existing] = await Promise.all([
    productGuesser(),
    db.invoice.findMany({ where: { sens: "DEBIT", status: { not: "ANNULE" } }, select: { tiers: true, numero: true, montant: true } }),
  ]);
  const get = (row: SheetCell[], field: Field): SheetCell => (cols[field] >= 0 ? (row[cols[field]] ?? null) : null);
  const errors: string[] = [];
  const duplicates: SupplierPlan["duplicates"] = [];
  const rows: SupplierRow[] = [];

  layout.sheet.rows.slice(layout.headerRow + 1).forEach((row, offset) => {
    const line = layout.headerRow + offset + 2;
    const benef = clean(get(row, "benef"));
    const amount = parseLooseAmount(get(row, "montant") as never);
    const hasAmount = Number.isFinite(amount) && amount > 0;
    if (!benef && !hasAmount) return;
    if (/^EXEMPLE/i.test(benef)) return;
    if (!benef || !hasAmount) {
      errors.push(`Ligne ${line} : bénéficiaire ou montant manquant`);
      return;
    }
    let facture = clean(get(row, "facture"));
    let dateDoc = dateCell(get(row, "dateDoc"));
    const embedded = facture.match(/^(.*?)\s+du\s+(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/i);
    if (embedded) {
      facture = (embedded[1] ?? "").trim();
      dateDoc = dateDoc || `${embedded[4]}-${(embedded[3] ?? "").padStart(2, "0")}-${(embedded[2] ?? "").padStart(2, "0")}`;
    }
    const typed = clean(get(row, "produit"));
    const guessed = typed ? null : guess(benef);
    const produit = typed ? productFromText(typed) : guessed || "Autre";
    const categorie = clean(get(row, "categorie")) || CATEGORY_BY_PRODUCT[produit];
    const nature = clean(get(row, "nature")) || "Règlement de facture prestataire";
    if (isPayrollInvoice(categorie, `${nature} ${benef}`)) {
      errors.push(`Ligne ${line} : salaires / CNAS / G50 à saisir dans l'onglet RH`);
      return;
    }
    const item: SupplierRow = {
      benef: benef.toUpperCase(),
      facture,
      dateDoc,
      montant: round2(amount),
      produit,
      produitDeduit: !typed && guessed !== "" && guessed !== null,
      categorie,
      nature,
      mode: /CH/.test(norm(get(row, "mode"))) ? "CHEQUE" : "VIRMT",
      cheque: clean(get(row, "cheque")),
      banque: clean(get(row, "banque")),
      datePay: dateCell(get(row, "datePay")),
      groupe: clean(get(row, "groupe")),
      adresse: clean(get(row, "adresse")),
      objet: clean(get(row, "objet")),
      rib: String(get(row, "rib") ?? "").replace(/\D/g, ""),
    };
    const key = item.facture ? invoiceKey(item.facture) : "";
    const same = (other: { tiers: string; numero: string; montant: number }): boolean =>
      beneficiaryKey(other.tiers) === beneficiaryKey(item.benef) && Math.abs(other.montant - item.montant) < 0.01 && (!key || invoiceKey(other.numero) === key);
    const known = existing.some((invoice) => same({ tiers: invoice.tiers, numero: invoice.numero, montant: Number(invoice.montant) }));
    const inFile = rows.some((other) => same({ tiers: other.benef, numero: other.facture, montant: other.montant }));
    if (known || inFile) duplicates.push({ benef: item.benef, facture: item.facture, montant: item.montant });
    else rows.push(item);
  });

  const buckets = new Map<string, SupplierRow[]>();
  rows.forEach((item, index) => {
    const key = item.groupe ? `G:${item.groupe}|${beneficiaryKey(item.benef)}` : `U:${index}`;
    buckets.set(key, [...(buckets.get(key) ?? []), item]);
  });
  const groups: SupplierGroup[] = [...buckets.values()].map((list) => ({
    benef: list[0]!.benef,
    produit: list[0]!.produit,
    mode: list[0]!.mode,
    total: round2(list.reduce((sum, item) => sum + item.montant, 0)),
    rows: list,
  }));
  return ok({ groups, invoices: rows.length, total: round2(rows.reduce((sum, item) => sum + item.montant, 0)), duplicates, errors });
}

/** Lit le canevas et prépare l'import (factures et demandes à créer, doublons, lignes refusées). Rien n'est enregistré. */
export async function previewSupplierImport(actor: AuthUser, file: SupplierFile): Promise<ActionResult<SupplierPlan>> {
  return buildPlan(actor, file);
}

/**
 * Applique l'import : chaque facture est créée en Débit (en attente, déposée aujourd'hui) et sa demande de paiement
 * est créée à la suite des numéros existants (statut « à valider », ou « émise » si tout est déjà réglé).
 */
export async function applySupplierImport(actor: AuthUser, file: SupplierFile): Promise<ActionResult<{ invoices: number; requests: string[] }>> {
  const built = await buildPlan(actor, file);
  if (!built.success) return built;
  const { groups } = built.data;
  if (groups.length === 0) return fail("Aucune facture nouvelle à importer.", "VALIDATION");
  const today = todayIso();
  const base = Date.now();
  const createdRefs: string[] = [];
  let count = 0;
  try {
    for (const group of groups) {
      const legacyIds = group.rows.map(() => `n-${crypto.randomUUID()}`);
      const allPaid = group.rows.every((item) => item.datePay !== "");
      const first = group.rows[0]!;
      const request = await createWithNextNumber({
        date: fromIsoDate(today),
        beneficiaire: group.benef,
        adresse: first.adresse,
        montant: group.total,
        nature: first.nature,
        mode: group.mode,
        produit: group.produit,
        status: allPaid ? "emise" : "a_valider",
        source: "canevas",
        invoiceIds: legacyIds,
        pieces: group.rows.map((item) => `FACTURE N°: ${item.facture || "sans n°"}${item.dateDoc ? ` du ${formatDate(item.dateDoc)}` : ""}`),
        extra: {
          factures: group.rows.map((item) => ({ n: item.facture, d: item.dateDoc })),
          ...(group.rows.find((item) => item.rib)?.rib ? { rib: group.rows.find((item) => item.rib)?.rib } : {}),
          cree: { nom: actor.name, par: actor.id, le: new Date().toISOString() },
        } as Prisma.InputJsonObject,
      });
      try {
        await db.invoice.createMany({
          data: group.rows.map((item, index) => {
            const paid = item.datePay !== "";
            const year = Number((item.dateDoc || today).slice(0, 4));
            return {
              legacyId: legacyIds[index]!,
              sens: "DEBIT" as const,
              status: paid ? ("REGLE" as const) : ("EN_ATTENTE" as const),
              categorie: item.categorie,
              tiers: item.benef,
              numero: item.facture,
              libelle: item.objet || item.nature,
              montant: item.montant,
              dateOperation: paid ? fromIsoDate(item.datePay) : null,
              dateFacture: fromIsoDate(today),
              annee: year,
              mode: item.mode === "CHEQUE" ? ("CHEQUE" as const) : ("VIREMENT" as const),
              cheque: item.mode === "CHEQUE" ? item.cheque : "",
              banque: item.banque,
              nature: "Charge",
              classe: 6,
              paymentRefs: [request.ref],
              origine: "import canevas",
              ordre: base + count + index,
              payroll: false,
              extra: { dateDoc: item.dateDoc } as Prisma.InputJsonObject,
              createdById: actor.id,
              updatedById: actor.id,
            };
          }),
        });
      } catch (error) {
        await db.paymentRequest.delete({ where: { id: request.id } }).catch(() => undefined);
        throw error;
      }
      createdRefs.push(request.ref);
      count += group.rows.length;
    }
    await logAction(actor, "Import factures fournisseurs", `${file.name} : ${count} facture(s), ${createdRefs.length} demande(s) de paiement (${formatDA(built.data.total)})`);
    return ok({ invoices: count, requests: createdRefs });
  } catch (error) {
    console.error("[canevas] import :", error);
    return fail(`L'import s'est arrêté (${count} facture(s) déjà créée(s)). Relancez-le : les factures déjà créées seront ignorées.`, "DATABASE");
  }
}
