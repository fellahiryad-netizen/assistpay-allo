import { db } from "@/lib/db";
import { readWorkbook, type SheetCell, type SheetData } from "@/lib/spreadsheet";
import type { Invoice, Prisma } from "@/generated/prisma/client";
import { can } from "@/features/access/services/access-rules";
import type { AuthUser } from "@/features/access/types";
import { CLIENTS } from "@/features/billing/config";
import { writeExtra, readExtra } from "@/features/invoices/services/invoice-extra";
import { decimalToNumber } from "@/features/invoices/services/invoice-mapper";
import { canOnInvoice } from "@/features/invoices/services/invoice-rules";
import type { PaymentModeKey, SensKey } from "@/features/invoices/types";
import { logAction } from "@/features/journal/services/journal-service";
import { fail, ok, type ActionResult } from "@/types";
import { dayGap, fromIsoDate, parseLooseDate, toIsoDate, todayIso } from "@/utils/dates";
import { upperPlain } from "@/utils/text";

/** Fichier Excel reçu. */
export interface ImportFile {
  name: string;
  bytes: Uint8Array;
}

/** Ligne du fichier de suivi à ajouter. */
export interface SuiviNewRow {
  sens: SensKey;
  status: "EN_ATTENTE" | "REGLE" | "ANNULE";
  numero: string;
  tiers: string;
  libelle: string;
  categorie: string;
  montant: number;
  dateOperation: string | null;
  dateFacture: string | null;
  mode: PaymentModeKey | null;
  cheque: string;
  banque: string;
  nature: string;
  classe: number | null;
  annee: number;
}

/** Mise à jour d'une facture existante (champs modifiés, libellés prêts à afficher). */
export interface SuiviUpdate {
  id: string;
  numero: string;
  tiers: string;
  montant: number;
  changes: string[];
}

/** Facture lue dans un classeur de facturation partenaires (une feuille par facture). */
export interface PartnerSheetItem {
  sheet: string;
  num: string;
  key: string;
  date: string;
  ttc: number;
  client: string;
  per: string;
  objet: string;
  succ: string;
}

/** Action proposée pour une feuille du classeur partenaires. */
export interface PartnerPlanItem {
  kind: "new" | "maj";
  item: PartnerSheetItem;
  /** Facture du suivi concernée (correction de montant). */
  invoiceId: string | null;
  currentAmount: number | null;
  warning: string;
  on: boolean;
}

/** Aperçu d'un import : classeur de suivi ou classeur de facturation partenaires. */
export type InvoiceImportPlan =
  | { kind: "suivi"; sheet: string; add: SuiviNewRow[]; updates: SuiviUpdate[]; same: number; payroll: number; refused: number; conflicts: number }
  | { kind: "partenaires"; read: number; same: number; withoutTotal: number; items: PartnerPlanItem[] };

const PAYROLL_RE = /salaire|cnas|casnos|\bg ?50\b|\birg\b|\bibs\b|frais de mission|\bmission\b|^prime$|remboursement employ|charges de personnel/i;

const norm = (value: unknown): string => upperPlain(String(value ?? ""));
const clean = (value: unknown): string => String(value ?? "").replace(/ /g, " ").replace(/\s+/g, " ").trim();
const invoiceKey = (value: string): string => norm(value).replace(/[^A-Z0-9]/g, "").replace(/^(FACTURE|FACT|FAC|N)+/, "");

/** Montant lu dans une cellule (nombre, « 1 234,50 », « 1.234,50 DA »…) ; NaN si illisible. */
function amountOf(value: SheetCell): number {
  if (typeof value === "number") return value;
  const text = String(value ?? "").replace(/[\s  ]/g, "").replace(/(DA|DZD)$/i, "");
  if (!text) return Number.NaN;
  let t = text;
  if (t.includes(",") && t.includes(".")) t = t.lastIndexOf(",") > t.lastIndexOf(".") ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  else t = t.replace(",", ".");
  if (/^\(.*\)$/.test(t)) t = `-${t.slice(1, -1)}`;
  const parsed = Number.parseFloat(t);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

/** Date d'une cellule : objet Date, série Excel, « JJ/MM/AAAA » (ou « MM/JJ/AAAA » si le 2e nombre dépasse 12). */
function dateOf(value: SheetCell): string {
  if (value === null || value === "") return "";
  if (typeof value === "string") {
    const match = value.replace(/ /g, "").trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
    if (match) {
      let day = Number(match[1]);
      let month = Number(match[2]);
      if (month > 12 && day <= 12) [day, month] = [month, day];
      const year = match[3]!.length === 2 ? `20${match[3]}` : match[3]!;
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }
  return parseLooseDate(value);
}

function senseOf(value: SheetCell): SensKey | "" {
  const text = norm(value);
  return /CR/.test(text) ? "CREDIT" : /D.?B/.test(text) ? "DEBIT" : "";
}

function stateOf(value: SheetCell): "EN_ATTENTE" | "REGLE" | "ANNULE" | "" {
  const text = norm(value);
  return /REGL|PAY|SOLD/.test(text) ? "REGLE" : /ANNUL|REJET/.test(text) ? "ANNULE" : /ATT|COURS/.test(text) ? "EN_ATTENTE" : "";
}

function modeOf(value: SheetCell): PaymentModeKey | null {
  const text = norm(value);
  return /CH/.test(text) ? "CHEQUE" : /VIR/.test(text) ? "VIREMENT" : /VERS/.test(text) ? "VERSEMENT" : null;
}

/* ───────────── Classeur de suivi (mêmes colonnes que le suivi bancaire) ───────────── */

type SuiviField = "numero" | "tiers" | "libelle" | "categorie" | "montant" | "sens" | "etat" | "date" | "dateFacture" | "type" | "cheque" | "banque" | "nature" | "classe";

const SUIVI_COLUMNS: ReadonlyArray<readonly [SuiviField, readonly string[]]> = [
  ["numero", ["N° FACTURE", "N FACTURE", "NUMERO FACTURE", "FACTURE"]],
  ["tiers", ["LIBELLE", "TIERS", "FOURNISSEUR", "BENEFICIAIRE"]],
  ["libelle", ["DETAIL", "DESIGNATION", "OBJET", "MOTIF"]],
  ["categorie", ["COMMENTAIRE", "CATEGORIE", "CLIENT / CATEGORIE", "CLIENT"]],
  ["montant", ["MONTANT"]],
  ["sens", ["DEBIT OU CREDIT", "SENS"]],
  ["etat", ["ETAT DE LA DEMANDE", "ETAT"]],
  ["date", ["DATE DEPOT BANQUE", "DATE DE REGLEMENT", "DATE REGLEMENT", "DATE PAIEMENT"]],
  ["dateFacture", ["DATE DE DEPOT FACTURE", "DATE DEPOT FACTURE", "DATE FACTURE"]],
  ["type", ["TYPE", "MODE"]],
  ["cheque", ["N° DE CHEQUE", "N DE CHEQUE", "CHEQUE"]],
  ["banque", ["BANQUE"]],
  ["nature", ["NATURE"]],
  ["classe", ["CLASSE"]],
];

interface SuiviLayout {
  sheet: SheetData;
  headerRow: number;
  columns: Record<SuiviField, number>;
  year: number | null;
}

/** Feuille de suivi la plus plausible (nom avec 2026 / FACTUR…, sinon la dernière) et colonnes reconnues. */
function locateSuivi(sheets: SheetData[]): SuiviLayout | null {
  const named = sheets.filter((sheet) => sheet.rows.length > 1);
  const preferred = named.find((sheet) => /2026|BDG|FACTUR/i.test(sheet.name)) ?? named[named.length - 1];
  if (!preferred) return null;
  const keys = SUIVI_COLUMNS.flatMap(([, candidates]) => candidates);
  let headerRow = 0;
  let best = -1;
  for (let index = 0; index < Math.min(preferred.rows.length, 40); index += 1) {
    const score = (preferred.rows[index] ?? []).filter((cell) => {
      const text = norm(cell).trim();
      return text && keys.some((key) => text === key || text.includes(key));
    }).length;
    if (score > best) {
      best = score;
      headerRow = index;
    }
  }
  const header = (preferred.rows[headerRow] ?? []).map((cell) => norm(cell).replace(/\s+/g, " ").trim());
  const used = new Set<number>();
  const columns = Object.fromEntries(SUIVI_COLUMNS.map(([field]) => [field, -1])) as Record<SuiviField, number>;
  for (const [field, candidates] of SUIVI_COLUMNS) {
    let found = -1;
    for (const candidate of candidates) {
      found = header.findIndex((cell, index) => !used.has(index) && cell === candidate);
      if (found >= 0) break;
    }
    if (found < 0) {
      for (const candidate of candidates) {
        found = header.findIndex((cell, index) => !used.has(index) && cell !== "" && cell.includes(candidate));
        if (found >= 0) break;
      }
    }
    if (found >= 0) {
      columns[field] = found;
      used.add(found);
    }
  }
  if (columns.libelle < 0 && columns.tiers >= 0 && !header[columns.tiers + 1]) columns.libelle = columns.tiers + 1;
  if (columns.nature < 0 && columns.categorie >= 0 && !header[columns.categorie + 1]) columns.nature = columns.categorie + 1;
  const yearMatch = preferred.name.match(/20\d\d/);
  return { sheet: preferred, headerRow, columns, year: yearMatch ? Number(yearMatch[0]) : null };
}

export type ExistingInvoice = Pick<Invoice, "id" | "sens" | "numero" | "tiers" | "libelle" | "categorie" | "nature" | "cheque" | "banque" | "mode" | "status" | "classe" | "dateOperation" | "dateFacture"> & { montant: number };

async function loadExisting(): Promise<ExistingInvoice[]> {
  const rows = await db.invoice.findMany({
    select: { id: true, sens: true, numero: true, tiers: true, libelle: true, categorie: true, nature: true, cheque: true, banque: true, mode: true, status: true, classe: true, dateOperation: true, dateFacture: true, montant: true },
  });
  return rows.map((row) => ({ ...row, montant: decimalToNumber(row.montant) }));
}

const MODE_LABEL: Readonly<Record<PaymentModeKey, string>> = { VIREMENT: "virement", CHEQUE: "chèque", VERSEMENT: "versement", AUTRE: "autre" };

interface SuiviPatch {
  id: string;
  data: Prisma.InvoiceUpdateInput;
}

interface SuiviBuild {
  plan: Extract<InvoiceImportPlan, { kind: "suivi" }>;
  patches: SuiviPatch[];
}

function buildSuiviPlan(actor: AuthUser, layout: SuiviLayout, existing: ExistingInvoice[]): SuiviBuild {
  const { sheet, headerRow, columns } = layout;
  const cell = (row: SheetCell[], field: SuiviField): SheetCell => (columns[field] >= 0 ? (row[columns[field]] ?? null) : null);
  const prepared = existing.map((x) => ({ x, key: x.numero ? invoiceKey(x.numero) : "", tiers: norm(x.tiers) }));
  const used = new Set<string>();
  const add: SuiviNewRow[] = [];
  const updates: SuiviUpdate[] = [];
  const patches: SuiviPatch[] = [];
  let same = 0;
  let payroll = 0;
  let refused = 0;
  let conflicts = 0;
  const fallbackYear = layout.year ?? Number(todayIso().slice(0, 4));

  for (const row of sheet.rows.slice(headerRow + 1)) {
    const montant = amountOf(cell(row, "montant"));
    if (!(montant > 0)) continue;
    const r = {
      montant: Math.round(montant * 100) / 100,
      numero: clean(cell(row, "numero")),
      tiers: clean(cell(row, "tiers")),
      libelle: clean(cell(row, "libelle")),
      categorie: clean(cell(row, "categorie")),
      sens: senseOf(cell(row, "sens")) || "DEBIT",
      etat: stateOf(cell(row, "etat")),
      date: dateOf(cell(row, "date")),
      dateFacture: dateOf(cell(row, "dateFacture")),
      mode: modeOf(cell(row, "type")),
      cheque: clean(cell(row, "cheque")).replace(/^\/$/, ""),
      banque: clean(cell(row, "banque")),
      nature: clean(cell(row, "nature")),
      classe: ((): number | null => {
        const value = amountOf(cell(row, "classe"));
        return value === 6 || value === 7 ? value : null;
      })(),
    } as const;
    if (PAYROLL_RE.test(r.categorie) || PAYROLL_RE.test(r.tiers)) {
      payroll += 1;
      continue;
    }
    if (!canOnInvoice(actor, { sens: r.sens as SensKey, payroll: false }, "EDIT")) {
      refused += 1;
      continue;
    }
    const key = r.numero ? invoiceKey(r.numero) : "";
    let match: ExistingInvoice | undefined;
    if (key.length >= 3) match = prepared.find((p) => !used.has(p.x.id) && p.x.sens === r.sens && p.key === key && Math.abs(p.x.montant - r.montant) < 1)?.x;
    if (!match) {
      const tiers = norm(r.tiers);
      match = prepared.find(
        (p) =>
          !used.has(p.x.id) &&
          p.x.sens === r.sens &&
          Math.abs(p.x.montant - r.montant) < 0.01 &&
          p.tiers === tiers &&
          ((r.date && toIsoDate(p.x.dateOperation) === r.date) || (!r.date && !p.x.dateOperation) || (r.numero && p.key !== "" && p.key === key)),
      )?.x;
    }
    if (!match) {
      const status = r.etat || (r.date ? "REGLE" : "EN_ATTENTE");
      const year = Number((r.dateFacture || r.date).slice(0, 4)) || fallbackYear;
      add.push({
        sens: r.sens as SensKey, status, numero: r.numero, tiers: r.tiers, libelle: r.libelle, categorie: r.categorie, montant: r.montant,
        dateOperation: r.date || null, dateFacture: r.dateFacture || null, mode: r.mode, cheque: r.cheque, banque: r.banque, nature: r.nature,
        classe: r.classe ?? (r.sens === "CREDIT" ? 7 : 6), annee: layout.year ?? year,
      });
      continue;
    }
    used.add(match.id);
    const data: Prisma.InvoiceUpdateInput = {};
    const changes: string[] = [];
    if (r.date && r.date !== toIsoDate(match.dateOperation)) {
      data.dateOperation = fromIsoDate(r.date);
      changes.push(`réglée le ${r.date.split("-").reverse().join("/")}`);
    }
    if (r.dateFacture && r.dateFacture !== toIsoDate(match.dateFacture)) {
      data.dateFacture = fromIsoDate(r.dateFacture);
      changes.push("date de dépôt");
    }
    if (r.mode && r.mode !== match.mode) {
      data.mode = r.mode;
      changes.push(MODE_LABEL[r.mode]);
    }
    if (r.cheque && r.cheque !== clean(match.cheque)) {
      data.cheque = r.cheque;
      changes.push("n° de chèque");
    }
    if (r.banque && r.banque !== clean(match.banque)) {
      data.banque = r.banque;
      changes.push("banque");
    }
    for (const field of ["categorie", "libelle", "nature", "tiers"] as const) {
      if (r[field] && !clean(match[field])) {
        data[field] = r[field];
        changes.push(field);
      }
    }
    if (r.numero && !clean(match.numero)) {
      data.numero = r.numero;
      changes.push("n° facture");
    }
    if (r.classe && r.classe !== match.classe) {
      data.classe = r.classe;
      changes.push("classe");
    }
    if (r.etat && r.etat !== match.status) {
      if (match.status === "REGLE" && r.etat === "EN_ATTENTE") conflicts += 1;
      else {
        data.status = r.etat;
        changes.push(r.etat === "REGLE" ? "état → réglé" : r.etat === "ANNULE" ? "état → annulé" : "état → en attente");
      }
    }
    if (changes.length === 0) {
      same += 1;
      continue;
    }
    updates.push({ id: match.id, numero: match.numero, tiers: match.tiers, montant: match.montant, changes });
    patches.push({ id: match.id, data });
  }
  return { plan: { kind: "suivi", sheet: sheet.name, add, updates, same, payroll, refused, conflicts }, patches };
}

/* ───────────── Classeur de facturation partenaires (une feuille par facture) ───────────── */

interface Cell {
  r: number;
  c: number;
  v: string | number | boolean | Date;
}

const PARTNER_PREFIXES: ReadonlyArray<readonly [RegExp, string]> = [[/^GAM/, "GAM"], [/^TRUST/, "TRUST"], [/^MLA/, "MLA"], [/^CAAT/, "CAAT"], [/^CAAR/, "CAAR"], [/^TDA/, "TDA"]];

/** Clé d'une facture partenaire (« GAM-26 », n° 12 → « GAM-12 ») ; null pour les factures BDG ou illisibles. */
export function partnerKeyOf(numero: string): string | null {
  const match = numero.toUpperCase().replace(/\s+/g, "").match(/([A-Z]*)-?N?°?26-?0*(\d{1,5})(BDG)?$/);
  return match && !match[3] ? `${match[1] ?? ""}-${Number(match[2])}` : null;
}

function cellsOf(sheet: SheetData): Cell[] {
  const cells: Cell[] = [];
  sheet.rows.forEach((row, r) =>
    row.forEach((value, c) => {
      if (value !== null && value !== "") cells.push({ r, c, v: value });
    }),
  );
  return cells;
}

function parsePartnerSheets(sheets: SheetData[]): PartnerSheetItem[] {
  const out: PartnerSheetItem[] = [];
  for (const sheet of sheets) {
    const cells = cellsOf(sheet);
    if (cells.length === 0) continue;
    const at = (r: number, c: number): SheetCell => cells.find((z) => z.r === r && z.c === c)?.v ?? null;
    const right = (cell: Cell, numeric = false): SheetCell => {
      for (let k = 1; k <= 4; k += 1) {
        const value = at(cell.r, cell.c + k);
        if (value === null || value === "") continue;
        if (!numeric || Number.isFinite(amountOf(value))) return value;
      }
      return null;
    };
    const find = (re: RegExp): Cell | undefined => cells.find((z) => typeof z.v === "string" && re.test(norm(z.v).trim()));
    let num = "";
    let date: SheetCell = null;
    const factureCell = find(/^FACTURE\s*:?$/);
    if (factureCell) {
      num = clean(right(factureCell));
      const dateCell = find(/^CHERAGA LE/);
      date = dateCell ? right(dateCell) : null;
    } else {
      const numberCell = find(/^N°\s*[A-Z]+\s*26-?\d+/);
      if (numberCell) {
        num = clean(String(numberCell.v).replace(/^N°\s*/i, ""));
        const header = find(/^DATE DE FACTURATION/);
        date = header ? at(header.r + 1, header.c) : null;
      }
    }
    const key = num ? partnerKeyOf(num) : null;
    if (!num || /BDG/i.test(num) || !key) continue;
    const totalCell = cells.filter((z) => typeof z.v === "string" && /^TOTAL TTC$/.test(norm(z.v).replace(/\s+/g, " ").trim())).sort((a, b) => b.r - a.r)[0];
    const ttc = totalCell ? Math.round((amountOf(right(totalCell, true)) || 0) * 100) / 100 : 0;
    const clientCell = find(/^CLIENT\s*:?$/);
    const client = clientCell ? clean(at(clientCell.r + 1, clientCell.c) ?? right(clientCell)) : "";
    const periodCell = find(/^(MOIS DE|TRIMESTRE|PERIODE CONCERN|PERIODE|FLOTTE\s+CONCERN)/);
    let per = "";
    if (periodCell) {
      per = clean(periodCell.v);
      const next = right(periodCell);
      if (next && typeof next === "string") per += ` ${clean(next)}`;
      if (/MONTANT|DESIGNATION/i.test(per)) per = "";
    }
    const objectCell = find(/^(HONORAIRE|OBJET\s*:?)$/);
    const objet = objectCell ? clean(right(objectCell)) : "";
    const succText = `${per} ${cells.filter((z) => typeof z.v === "string" && /SUCCURSALE/.test(norm(z.v))).map((z) => String(z.v)).join(" ")}`;
    const succMatch = succText.match(/succursale\s+([A-Za-zéÉèÈ ]+?)(?:\s*\(|\s*$|\s*—|,)/i);
    out.push({ sheet: sheet.name, num, key, date: dateOf(date), ttc, client, per, objet, succ: succMatch?.[1] ? clean(succMatch[1]) : "" });
  }
  return out;
}

function buildPartnerPlan(items: PartnerSheetItem[], credits: ExistingInvoice[]): Extract<InvoiceImportPlan, { kind: "partenaires" }> {
  const used = new Set<string>();
  const planItems: PartnerPlanItem[] = [];
  let same = 0;
  let withoutTotal = 0;
  for (const item of items) {
    if (!(item.ttc > 0)) {
      withoutTotal += 1;
      continue;
    }
    const number = item.key.split("-")[1] ?? "";
    let found = credits.find((x) => !used.has(x.id) && partnerKeyOf(x.numero) === item.key && Math.abs(x.montant - item.ttc) <= 1)
      ?? credits.find((x) => !used.has(x.id) && partnerKeyOf(x.numero) === `-${number}` && Math.abs(x.montant - item.ttc) <= 1);
    if (found) {
      used.add(found.id);
      same += 1;
      continue;
    }
    found = credits.find((x) => {
      if (used.has(x.id) || partnerKeyOf(x.numero) !== item.key) return false;
      const filed = toIsoDate(x.dateFacture);
      return !item.date || !filed || dayGap(filed, item.date) <= 45;
    });
    if (found) {
      used.add(found.id);
      const settled = found.status === "REGLE";
      planItems.push({
        kind: "maj", item, invoiceId: found.id, currentAmount: found.montant,
        warning: settled ? `facture déjà réglée le ${(toIsoDate(found.dateOperation) ?? "").split("-").reverse().join("/")}` : "",
        on: !settled,
      });
      continue;
    }
    planItems.push({ kind: "new", item, invoiceId: null, currentAmount: null, warning: "", on: true });
  }
  return { kind: "partenaires", read: items.length, same, withoutTotal, items: planItems };
}

/* ───────────── Service ───────────── */

function guardAccess(actor: AuthUser): ActionResult<true> {
  if (!can(actor, "FCLI", "EDIT") && !can(actor, "FFOUR", "EDIT")) return fail("Vous n'avez pas le droit d'importer des factures.", "FORBIDDEN");
  if (!can(actor, "A_IMPORT", "EDIT")) return fail("Le droit « Boutons d'import de fichiers » ne vous est pas accordé.", "FORBIDDEN");
  return ok(true);
}

/** Résultat de l'analyse d'un classeur (plan affiché + modifications prêtes à écrire). */
interface Analysis {
  plan: InvoiceImportPlan;
  suivi: SuiviBuild | null;
}

/** Analyse des feuilles d'un classeur par rapport aux factures existantes (sans accès base : testable seule). */
export function analyseSheets(actor: AuthUser, sheets: SheetData[], existing: ExistingInvoice[]): ActionResult<Analysis> {
  const partnerItems = parsePartnerSheets(sheets);
  if (partnerItems.length >= 3) {
    const credits = existing.filter((x) => x.sens === "CREDIT" && x.numero);
    return ok({ plan: buildPartnerPlan(partnerItems, credits), suivi: null });
  }
  const layout = locateSuivi(sheets);
  if (!layout || layout.columns.montant < 0) return fail("Colonne « Montant » introuvable : utilisez le classeur de suivi (mêmes colonnes que l'export) ou le classeur de facturation partenaires.", "VALIDATION");
  const built = buildSuiviPlan(actor, layout, existing);
  return ok({ plan: built.plan, suivi: built });
}

async function analyse(actor: AuthUser, file: ImportFile): Promise<ActionResult<Analysis>> {
  let sheets: SheetData[];
  try {
    sheets = readWorkbook(file.bytes);
  } catch {
    return fail("Ce fichier n'a pas pu être lu. Utilisez un fichier Excel (.xlsx, .xlsm) ou CSV.", "VALIDATION");
  }
  return analyseSheets(actor, sheets, await loadExisting());
}

/** Aperçu de l'import d'un fichier de facturation : rien n'est enregistré. */
export async function previewInvoiceImport(actor: AuthUser, file: ImportFile): Promise<ActionResult<InvoiceImportPlan>> {
  const guard = guardAccess(actor);
  if (!guard.success) return guard;
  try {
    const analysed = await analyse(actor, file);
    return analysed.success ? ok(analysed.data.plan) : analysed;
  } catch (error) {
    console.error("[import factures] aperçu :", error);
    return fail("Le fichier n'a pas pu être analysé.");
  }
}

/**
 * Applique l'import. Pour un classeur partenaires, `selected` liste les feuilles cochées (toutes celles proposées par défaut).
 * Les montants du suivi ne sont jamais réécrits, sauf correction explicitement cochée d'une facture partenaire.
 */
export async function applyInvoiceImport(actor: AuthUser, file: ImportFile, selected: string[] | null): Promise<ActionResult<{ created: number; updated: number }>> {
  const guard = guardAccess(actor);
  if (!guard.success) return guard;
  try {
    const analysed = await analyse(actor, file);
    if (!analysed.success) return analysed;
    const { plan, suivi } = analysed.data;
    const author = { nom: actor.name, par: actor.id, le: new Date().toISOString() };
    let created = 0;
    let updated = 0;
    if (plan.kind === "suivi" && suivi) {
      let order = Date.now();
      for (const row of plan.add) {
        order += 1;
        await db.invoice.create({
          data: {
            legacyId: `n-${crypto.randomUUID()}`, sens: row.sens, status: row.status, categorie: row.categorie, tiers: row.tiers, numero: row.numero, libelle: row.libelle,
            montant: row.montant, dateOperation: fromIsoDate(row.dateOperation), dateFacture: fromIsoDate(row.dateFacture), annee: row.annee, mode: row.mode,
            cheque: row.cheque, banque: row.banque, nature: row.nature, classe: row.classe, origine: "import", ordre: order, payroll: false,
            extra: writeExtra({ cree: author, maj: author }), createdById: actor.id, updatedById: actor.id,
          },
        });
        created += 1;
      }
      for (const patch of suivi.patches) {
        const current = await db.invoice.findUnique({ where: { id: patch.id }, select: { extra: true } });
        await db.invoice.update({ where: { id: patch.id }, data: { ...patch.data, extra: writeExtra({ ...readExtra(current?.extra ?? {}), maj: author }), updatedById: actor.id } });
        updated += 1;
      }
      await logAction(actor, "Import fichier de facturation", `${file.name} : ${created} nouvelle(s), ${updated} mise(s) à jour`);
      return ok({ created, updated });
    }
    if (plan.kind === "partenaires") {
      const chosen = new Set(selected ?? plan.items.filter((x) => x.on).map((x) => x.item.sheet));
      let order = Date.now();
      for (const entry of plan.items.filter((x) => chosen.has(x.item.sheet))) {
        const { item } = entry;
        if (entry.kind === "maj" && entry.invoiceId) {
          const current = await db.invoice.findUnique({ where: { id: entry.invoiceId }, select: { extra: true, montant: true } });
          await db.invoice.update({
            where: { id: entry.invoiceId },
            data: { montant: item.ttc, extra: writeExtra({ ...readExtra(current?.extra ?? {}), montantAvant: current ? decimalToNumber(current.montant) : null, maj: author }), updatedById: actor.id },
          });
          updated += 1;
          continue;
        }
        const prefix = PARTNER_PREFIXES.find(([re]) => re.test(item.num.toUpperCase()))?.[1] ?? "";
        const client = CLIENTS[prefix];
        const succ = item.succ ? item.succ.charAt(0).toUpperCase() + item.succ.slice(1).toLowerCase() : "";
        const withBranch = Boolean(succ) && (prefix === "CAAR" || prefix === "CAAT");
        order += 1;
        await db.invoice.create({
          data: {
            legacyId: `n-${crypto.randomUUID()}`, sens: "CREDIT", status: "EN_ATTENTE", categorie: client?.cat ?? prefix,
            tiers: `${client?.tiers ?? item.client}${withBranch ? ` ${succ}` : ""}`.trim(), numero: item.num,
            libelle: [item.objet && !/^ASSISTANCE ROUTI/i.test(item.objet) ? item.objet : "Honoraire", item.per].filter(Boolean).join(" – ").slice(0, 120),
            montant: item.ttc, dateFacture: fromIsoDate(item.date || null), annee: Number((item.date || todayIso()).slice(0, 4)),
            nature: "Production Assistance", classe: 7, succursale: withBranch ? `Succursale ${succ}` : "", origine: "fichier facturation partenaires", ordre: order,
            extra: writeExtra({ cree: author, maj: author }), createdById: actor.id, updatedById: actor.id,
          },
        });
        created += 1;
      }
      await logAction(actor, "Import fichier facturation partenaires", `${file.name} : ${created} facture(s) ajoutée(s), ${updated} corrigée(s)`);
      return ok({ created, updated });
    }
    return fail("Rien à importer.", "VALIDATION");
  } catch (error) {
    console.error("[import factures] application :", error);
    return fail("L'import a échoué. Les lignes déjà enregistrées restent en place : relancez l'import, il ne crée jamais deux fois la même facture.");
  }
}
