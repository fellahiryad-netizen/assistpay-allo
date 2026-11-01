import { readWorkbook, writeWorkbook, type SheetCell, type SheetData, type SheetToWrite } from "@/lib/spreadsheet";
import { requireAccess } from "@/features/access/services/access-rules";
import type { AuthUser } from "@/features/access/types";
import { logAction } from "@/features/journal/services/journal-service";
import { fail, ok, type ActionResult } from "@/types";
import { round2 } from "@/utils/amounts";
import { formatDA } from "@/utils/format";

/** Mois en lettres capitales (titres des états). */
const MOIS = ["JANVIER", "FÉVRIER", "MARS", "AVRIL", "MAI", "JUIN", "JUILLET", "AOÛT", "SEPTEMBRE", "OCTOBRE", "NOVEMBRE", "DÉCEMBRE"] as const;

/** Réglages d'un récapitulatif GAM. */
export interface GamOptions {
  /** Taux de TVA en pourcentage (19 par défaut). */
  tva: number;
  /** Colonnes à ne pas reprendre, séparées par « ; ». */
  exclure: string;
  /** Mois du récapitulatif (1 à 12). */
  mois: number | null;
}

/** Ligne de facture reprise dans l'état d'une agence. */
export interface GamRow {
  line: number;
  cells: string[];
  /** Montant HT lu ; null si illisible. */
  amount: number | null;
  /** Texte brut de la cellule montant quand il est illisible. */
  raw: string;
}

/** État d'une agence. */
export interface GamAgency {
  name: string;
  sheet: string;
  rows: GamRow[];
  ht: number;
  tva: number;
  ttc: number;
}

/** Résultat de l'analyse d'un fichier de factures GAM. */
export interface GamEtats {
  fichier: string;
  feuille: string;
  headerLine: number;
  columns: string[];
  htIndex: number;
  mois: number;
  months: Array<{ mois: number; count: number }>;
  titre: string;
  titreGeneral: string;
  tauxTva: number;
  agencies: GamAgency[];
  totals: { n: number; ht: number; tva: number; ttc: number };
  controls: Array<{ tone: "ok" | "warn" | "err"; text: string }>;
}

const norm = (value: unknown): string =>
  String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");

const FACTURE = new Set("ndossier dossier nfacture numerofacture numfacture facture nofacture nodefacture ndefacture numerodossier numdossier nodossier reffacture numerodefacture ndedossier".split(" "));
const HT = new Set("prix montantht ht totalht prixht montant montanthorstaxe montanthorstaxes prixhorstaxe montanthorstva".split(" "));
type Role = "TTC" | "TVA" | "AGENCE" | "FACTURE" | "DATE" | "HT" | "";

function roleOf(header: SheetCell | undefined): Role {
  const n = norm(header);
  if (!n) return "";
  if (n.includes("ttc")) return "TTC";
  if (n.includes("tva")) return "TVA";
  if (n.includes("agence") || n === "succursale") return "AGENCE";
  if (FACTURE.has(n)) return "FACTURE";
  if (["date", "datefacture", "datedefacture", "datefact"].includes(n)) return "DATE";
  if (HT.has(n)) return "HT";
  return "";
}

function amountOf(value: SheetCell | undefined): { ok: boolean; empty: boolean; value: number } {
  if (value === null || value === undefined || value === "") return { ok: false, empty: true, value: 0 };
  if (typeof value === "number") return { ok: Number.isFinite(value), empty: false, value };
  if (value instanceof Date || typeof value === "boolean") return { ok: false, empty: false, value: 0 };
  let text = value.replace(/[  \s]/g, "").replace(/DZD|DA/g, "");
  if (!text) return { ok: false, empty: true, value: 0 };
  const comma = text.lastIndexOf(",");
  const dot = text.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) text = comma > dot ? text.replace(/\./g, "").replace(",", ".") : text.replace(/,/g, "");
  else if (comma >= 0) text = (text.match(/,/g) ?? []).length > 1 ? text.replace(/,/g, "") : text.replace(",", ".");
  if (!/^-?[0-9]*\.?[0-9]*$/.test(text) || !/[0-9]/.test(text)) return { ok: false, empty: false, value: 0 };
  return { ok: true, empty: false, value: parseFloat(text) };
}

function dateOf(value: SheetCell | undefined): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (value === null || value === undefined) return null;
  const parts = String(value).trim().split(" ")[0]?.replace(/[-.]/g, "/").split("/") ?? [];
  if (parts.length !== 3 || !parts.every((part) => /^\d+$/.test(part))) return null;
  let [a, m, j] = parts.map(Number) as [number, number, number];
  if ((parts[0] ?? "").length !== 4) {
    [j, m, a] = [a, m, j];
    if (a < 100) a += 2000;
  }
  const date = new Date(Date.UTC(a, m - 1, j));
  return date.getUTCMonth() === m - 1 && date.getUTCDate() === j ? date : null;
}

const pad = (n: number): string => String(n).padStart(2, "0");
const dateText = (date: Date): string => `${pad(date.getUTCDate())}/${pad(date.getUTCMonth() + 1)}/${date.getUTCFullYear()}`;

function cellText(value: SheetCell | undefined): string {
  if (value === null || value === undefined) return "";
  return value instanceof Date ? dateText(value) : String(value);
}

function safeSheetName(name: string, used: Set<string>): string {
  let base = name.replace(/[:\\/?*[\]]/g, "_").trim().replace(/^'+|'+$/g, "").trim() || "Agence";
  base = base.slice(0, 31).trim();
  const reserved = ["SOURCE", "RÉCAPITULATIF GÉNÉRAL", "HISTORY"];
  let candidate = base;
  let k = 1;
  while (used.has(candidate.toUpperCase()) || reserved.includes(candidate.toUpperCase())) {
    k += 1;
    const suffix = ` (${k})`;
    candidate = base.slice(0, 31 - suffix.length).trim() + suffix;
  }
  used.add(candidate.toUpperCase());
  return candidate;
}

const titleFor = (mois: number, general: boolean): string => {
  const name = MOIS[mois - 1] ?? "";
  const de = /^[AO]/.test(name) ? `D'${name}` : `DE ${name}`;
  return `ÉTAT RÉCAPITULATIF ${general ? "GÉNÉRAL " : ""}DES FACTURES - MOIS ${de}`;
};

/**
 * Répartit les factures d'un classeur par agence (logique du fichier « États des factures par agence ») :
 * en-têtes trouvés dans les 60 premières lignes (colonnes Agence et Prix / Montant HT), une feuille par agence,
 * TVA et TTC calculés par agence, contrôles de cohérence avec la source.
 */
export function buildGamEtats(sheets: SheetData[], fichier: string, options: GamOptions): ActionResult<GamEtats> {
  let found: { sheet: SheetData; hdr: number; roles: Role[] } | null = null;
  for (const sheet of sheets) {
    for (let i = 0; i < Math.min(sheet.rows.length, 60) && !found; i += 1) {
      const roles = (sheet.rows[i] ?? []).map(roleOf);
      if (roles.includes("AGENCE") && roles.includes("HT")) found = { sheet, hdr: i, roles };
    }
    if (found) break;
  }
  if (!found) return fail("Aucune ligne d'en-têtes trouvée : il faut une colonne « Agence » et une colonne « Prix / Montant HT » dans les 60 premières lignes.", "VALIDATION");
  const { sheet, hdr, roles } = found;
  const header = sheet.rows[hdr] ?? [];
  const cAg = roles.indexOf("AGENCE");
  const cFac = roles.indexOf("FACTURE");
  const cHt = roles.indexOf("HT");
  const cDt = roles.indexOf("DATE");
  if (cFac < 0) return fail("Colonne du n° de facture / dossier introuvable (ex. « N°Dossier »).", "VALIDATION");
  const excluded = options.exclure.split(/[;,|]/).map(norm).filter(Boolean);
  const out: number[] = [];
  header.forEach((h, c) => {
    if (cellText(h).trim() === "" || roles[c] === "TVA" || roles[c] === "TTC") return;
    if (![cAg, cFac, cHt, cDt].includes(c) && excluded.includes(norm(h))) return;
    out.push(c);
  });
  const taux = options.tva / 100;
  const groups = new Map<string, { name: string; rows: GamRow[] }>();
  const stat = { nonaff: 0, ko: 0, vide: 0, dup: 0, declared: [] as number[] };
  const seen = new Set<string>();
  const monthCount = new Map<number, number>();
  for (let i = hdr + 1; i < sheet.rows.length; i += 1) {
    const row = sheet.rows[i];
    if (!row) continue;
    const fac = cellText(row[cFac]).trim();
    const raw = row[cAg];
    const rawText = cellText(raw);
    const agency = (typeof raw === "string" || (rawText !== "" && fac) ? rawText : "").replace(/ /g, " ").trim().replace(/\s+/g, " ");
    if (!agency) {
      if (!fac) {
        if (row.some((x) => cellText(x).trim())) {
          const m = amountOf(row[cHt]);
          if (m.ok) stat.declared.push(m.value);
        }
      } else stat.nonaff += 1;
      continue;
    }
    const m = amountOf(row[cHt]);
    if (!m.ok) {
      if (m.empty) stat.vide += 1;
      else stat.ko += 1;
    }
    if (fac) {
      const key = fac.toUpperCase();
      if (seen.has(key)) stat.dup += 1;
      seen.add(key);
    }
    const date = cDt >= 0 ? dateOf(row[cDt]) : null;
    if (date) monthCount.set(date.getUTCMonth() + 1, (monthCount.get(date.getUTCMonth() + 1) ?? 0) + 1);
    const key = agency.toUpperCase();
    const group = groups.get(key) ?? { name: agency, rows: [] };
    group.rows.push({
      line: i + 1,
      cells: out.map((c) => (c === cDt && date ? dateText(date) : cellText(row[c]))),
      amount: m.ok ? m.value : null,
      raw: cellText(row[cHt]),
    });
    groups.set(key, group);
  }
  const months = [...monthCount.entries()].map(([mois, count]) => ({ mois, count })).sort((a, b) => b.count - a.count);
  const mois = options.mois && options.mois >= 1 && options.mois <= 12 ? options.mois : (months[0]?.mois ?? new Date().getMonth() + 1);
  const used = new Set<string>();
  const agencies: GamAgency[] = [...groups.values()]
    .sort((a, b) => a.name.localeCompare(b.name, "fr", { sensitivity: "base", numeric: true }))
    .map((group) => {
      const ht = round2(group.rows.reduce((sum, r) => sum + (r.amount ?? 0), 0));
      const tva = round2(ht * taux);
      return { name: group.name, sheet: safeSheetName(group.name, used), rows: group.rows, ht, tva, ttc: round2(ht + tva) };
    });
  if (agencies.length === 0) return fail("Aucune facture rattachée à une agence n'a été trouvée.", "VALIDATION");
  const n = agencies.reduce((sum, a) => sum + a.rows.length, 0);
  const totals = { n, ht: round2(agencies.reduce((s, a) => s + a.ht, 0)), tva: round2(agencies.reduce((s, a) => s + a.tva, 0)), ttc: round2(agencies.reduce((s, a) => s + a.ttc, 0)) };
  const controls: GamEtats["controls"] = [{ tone: "ok", text: `Colonnes reprises : ${out.map((c) => cellText(header[c]).trim()).join(" · ")}` }];
  controls.push({ tone: "ok", text: `${n} facture(s) réparties entre ${agencies.length} agence(s) · total HT ${formatDA(totals.ht)} = somme des agences` });
  if (stat.declared.length === 1) {
    const declared = stat.declared[0] ?? 0;
    const same = Math.abs(declared - totals.ht) < 0.005;
    controls.push({ tone: same ? "ok" : "warn", text: `Total déjà présent en bas de la source : ${formatDA(declared)}${same ? " (identique)" : " (DIFFÉRENT)"}` });
  }
  if (stat.nonaff) controls.push({ tone: "warn", text: `${stat.nonaff} ligne(s) avec un n° de facture mais sans agence : non reprises` });
  if (stat.ko) controls.push({ tone: "warn", text: `${stat.ko} montant(s) non numérique(s) : surlignés et exclus des totaux` });
  if (stat.vide) controls.push({ tone: "warn", text: `${stat.vide} facture(s) sans montant (comptées 0)` });
  if (stat.dup) controls.push({ tone: "warn", text: `${stat.dup} numéro(s) de facture en double (lignes conservées)` });
  if (months.length > 1) controls.push({ tone: "warn", text: `Les dates couvrent plusieurs mois (${[...months].sort((a, b) => a.mois - b.mois).map((m) => `${(MOIS[m.mois - 1] ?? "").toLowerCase()} ${m.count}`).join(", ")}) : vérifiez le mois du récapitulatif.` });
  return ok({
    fichier,
    feuille: sheet.name,
    headerLine: hdr + 1,
    columns: out.map((c) => cellText(header[c]).trim()),
    htIndex: out.indexOf(cHt),
    mois,
    months,
    titre: titleFor(mois, false),
    titreGeneral: titleFor(mois, true),
    tauxTva: options.tva,
    agencies,
    totals,
    controls,
  });
}

/** Aperçu des états GAM d'un fichier (rien n'est enregistré). */
export async function previewGamEtats(actor: AuthUser, file: { name: string; bytes: Uint8Array }, options: GamOptions): Promise<ActionResult<GamEtats>> {
  const guard = requireAccess(actor, "BDGV");
  if (!guard.success) return guard;
  let sheets: SheetData[];
  try {
    sheets = readWorkbook(file.bytes);
  } catch {
    return fail("Ce fichier n'a pas pu être lu. Utilisez un fichier Excel (.xlsx, .xlsm) ou CSV.", "VALIDATION");
  }
  return buildGamEtats(sheets, file.name, options);
}

/** Classeur Excel des états : récapitulatif général puis une feuille par agence. */
export async function exportGamEtats(actor: AuthUser, file: { name: string; bytes: Uint8Array }, options: GamOptions): Promise<ActionResult<{ filename: string; base64: string }>> {
  const guard = requireAccess(actor, "BDGV");
  if (!guard.success) return guard;
  const allowed = requireAccess(actor, "A_EXPORT", "EDIT");
  if (!allowed.success) return allowed;
  const result = await previewGamEtats(actor, file, options);
  if (!result.success) return result;
  const etats = result.data;
  const pc = `TVA ${Number(etats.tauxTva.toFixed(2))} %`;
  const stamp = `Établi par : ${actor.name} - ${new Date().toLocaleDateString("fr-FR", { timeZone: "Africa/Algiers" })}`;
  const sheets: SheetToWrite[] = [
    {
      name: "RÉCAPITULATIF GÉNÉRAL",
      widths: [6, 36, 20, 18, 18, 18],
      rows: [
        [etats.titreGeneral],
        [],
        ["N°", "Agence", "Nombre de factures", "TOTAL HT", pc, "TOTAL TTC"],
        ...etats.agencies.map((a, i) => [i + 1, a.name, a.rows.length, a.ht, a.tva, a.ttc]),
        ["", "TOTAL GÉNÉRAL", etats.totals.n, etats.totals.ht, etats.totals.tva, etats.totals.ttc],
        [],
        ["", "", "", "", "TOTAL HT", etats.totals.ht],
        ["", "", "", "", pc, etats.totals.tva],
        ["", "", "", "", "TOTAL TTC", etats.totals.ttc],
        [],
        [stamp],
      ],
    },
    ...etats.agencies.map((a): SheetToWrite => ({
      name: a.sheet,
      widths: etats.columns.map((_, index) => (index === etats.htIndex ? 18 : 20)),
      rows: [
        [etats.titre],
        [],
        etats.columns,
        ...a.rows.map((r) => r.cells.map((cell, index) => (index === etats.htIndex ? (r.amount ?? r.raw) : cell))),
        [],
        ...([["TOTAL HT", a.ht], [pc, a.tva], ["TOTAL TTC", a.ttc]] as const).map(([label, value]) => {
          const line: Array<string | number> = etats.columns.map(() => "");
          line[Math.max(etats.columns.length - 2, 0)] = label;
          line[etats.columns.length - 1] = value;
          return line;
        }),
        [],
        [stamp],
      ],
    })),
  ];
  const bytes = writeWorkbook(sheets);
  await logAction(actor, "États des factures BDG GAM", `${etats.fichier} · ${etats.agencies.length} agences · ${etats.totals.n} factures · HT ${formatDA(etats.totals.ht)}`);
  const month = MOIS[etats.mois - 1] ?? "";
  return ok({ filename: `ETATS_FACTURES_GAM_${month}.xlsx`, base64: Buffer.from(bytes).toString("base64") });
}
