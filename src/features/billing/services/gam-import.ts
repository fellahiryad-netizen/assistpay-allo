import { db } from "@/lib/db";
import { readWorkbook } from "@/lib/spreadsheet";
import { requireAccess } from "@/features/access/services/access-rules";
import type { AuthUser } from "@/features/access/types";
import { gamLineToBillingRow, splitGamFile, type GamLine, type GamSplit } from "@/features/billing/lib/gam-split";
import { periodLabel } from "@/features/billing/services/billing-calc";
import { prepareDraft, saveDraft } from "@/features/billing/services/billing-service";
import { logAction } from "@/features/journal/services/journal-service";
import { fail, ok, type ActionResult } from "@/types";

/** Aperçu de l'import du fichier système BDG GAM (rien n'est enregistré). */
export interface GamImportPreview {
  fileNum: string;
  fileDate: string;
  nbConv: number;
  nbTakaful: number;
  convHt: number;
  takafulHt: number;
  totalHt: number;
  fileTotalHt: number | null;
  controlOk: boolean;
  unknown: Array<{ row: number; dos: string; sin: string; reason: string }>;
  duplicates: Array<{ dos: string; rows: number[] }>;
}

/** Une facture globale créée par l'import. */
export interface GamCreated {
  kind: "CONV" | "TAKAFUL";
  id: string;
  num: string;
  nb: number;
  ht: number;
  ttc: number;
}

/** Options de création : période de facturation (AAAA-MM) et date de la facture (AAAA-MM-JJ). */
export interface GamImportOptions {
  per: string;
  date: string;
}

function load(bytes: Uint8Array): ActionResult<GamSplit> {
  const sheets = readWorkbook(bytes);
  const first = sheets[0];
  if (!first) return fail("Le fichier ne contient aucune feuille.", "VALIDATION");
  return splitGamFile(first.rows);
}

function previewOf(split: GamSplit): GamImportPreview {
  return {
    fileNum: split.fileNum,
    fileDate: split.fileDate,
    nbConv: split.conv.length,
    nbTakaful: split.takaful.length,
    convHt: split.convHt,
    takafulHt: split.takafulHt,
    totalHt: split.totalHt,
    fileTotalHt: split.fileTotalHt,
    controlOk: split.controlOk,
    unknown: split.unknown,
    duplicates: split.duplicates,
  };
}

/**
 * Lit le fichier extrait du système (BDG GAM) et sépare les dossiers : conventionnel (N° de sinistre à 10 chiffres) et Takaful
 * (12 chiffres une fois lettres et symboles retirés). Contrôle le total HT avec celui du fichier. Aperçu seulement.
 */
export async function previewGamImport(actor: AuthUser, bytes: Uint8Array): Promise<ActionResult<GamImportPreview>> {
  const guard = requireAccess(actor, "FACT");
  if (!guard.success) return guard;
  const split = load(bytes);
  if (!split.success) return split;
  return ok(previewOf(split.data));
}

/**
 * Crée les deux factures globales BDG GAM (Conventionnelle et Takaful) à partir du fichier système, avec le détail des dossiers.
 * Refus si un N° de sinistre n'est ni à 10 ni à 12 chiffres ou si le total ne correspond pas à celui du fichier.
 * Garde anti-doublon propre à l'import : refus si une facture du même type (Conventionnelle ou Takaful) existe déjà pour la même période,
 * avant d'en créer aucune (la garde de saveDraft ne couvre pas ces préréglages, sans succursale).
 */
export async function applyGamImport(actor: AuthUser, bytes: Uint8Array, options: GamImportOptions): Promise<ActionResult<GamCreated[]>> {
  const guard = requireAccess(actor, "FACT", "EDIT");
  if (!guard.success) return guard;
  if (!/^\d{4}-\d{2}$/.test(options.per) || !/^\d{4}-\d{2}-\d{2}$/.test(options.date)) return fail("Période ou date invalide.", "VALIDATION");
  const split = load(bytes);
  if (!split.success) return split;
  const data = split.data;
  if (data.unknown.length) return fail(`${data.unknown.length} dossier(s) ont un N° de sinistre ni à 10 ni à 12 chiffres : corrigez le fichier avant l'import.`, "VALIDATION");
  if (data.fileTotalHt !== null && !data.controlOk) return fail("Le total des dossiers ne correspond pas au Total HT du fichier : import refusé.", "VALIDATION");
  const kinds: Array<{ kind: GamCreated["kind"]; preset: string; lines: GamLine[] }> = [
    { kind: "CONV", preset: "g_bdgab_c", lines: data.conv },
    { kind: "TAKAFUL", preset: "g_bdgab_t", lines: data.takaful },
  ];
  const existing: string[] = [];
  for (const entry of kinds) {
    if (entry.lines.length === 0) continue;
    const docs = await db.issuedInvoice.findMany({ where: { AND: [{ payload: { path: ["preset"], equals: entry.preset } }, { payload: { path: ["per"], equals: options.per } }] }, select: { num: true } });
    if (docs.length) existing.push(`${entry.kind === "CONV" ? "Conventionnelle" : "Takaful"} ${docs.map((doc) => doc.num).join(", ")}`);
  }
  if (existing.length) return fail(`Une facture globale existe déjà pour ${periodLabel(options.per)} : ${existing.join(" ; ")}. Aucune facture n'a été créée ; supprimez l'existante ou changez la période.`, "CONFLICT");
  const created: GamCreated[] = [];
  for (const entry of kinds) {
    if (entry.lines.length === 0) continue;
    // La numérotation se calcule après chaque enregistrement : la Takaful prend le numéro qui suit la Conventionnelle.
    const prepared = await prepareDraft(actor, { preset: entry.preset });
    if (!prepared.success) return created.length ? fail(`${describe(created)} Échec de la suivante : ${prepared.error}`, prepared.code) : prepared;
    const draft = { ...prepared.data, date: options.date, per: options.per, perTxt: periodLabel(options.per), rows: entry.lines.map(gamLineToBillingRow) };
    const saved = await saveDraft(actor, { draft });
    if (!saved.success) return created.length ? fail(`${describe(created)} La facture ${entry.kind === "TAKAFUL" ? "Takaful" : "Conventionnelle"} n'a pas été créée : ${saved.error}`, saved.code) : saved;
    created.push({ kind: entry.kind, id: saved.data.id, num: draft.num, nb: entry.lines.length, ht: entry.kind === "CONV" ? data.convHt : data.takafulHt, ttc: saved.data.ttc });
  }
  await logAction(actor, "Import BDG GAM : factures globales créées", `${created.map((item) => `${item.num} (${item.nb} dossiers)`).join(" ; ")} — fichier ${data.fileNum || "sans numéro"}`);
  return ok(created);
}

function describe(created: GamCreated[]): string {
  return `Déjà créée : ${created.map((item) => `${item.num} (${item.nb} dossiers)`).join(", ")}.`;
}
