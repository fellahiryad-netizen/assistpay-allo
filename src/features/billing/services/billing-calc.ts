import { MODELS, presetById, r2, num, type BillingColumn, type BillingModel, type BillingPreset, type BillingRow, type BillingTotals, type ComputedRow } from "@/features/billing/config";
import type { BillingComputation, BillingDraft } from "@/features/billing/types";
import { MONTHS_FR } from "@/utils/dates";

/** Modèle d'un préréglage. */
export function modelOf(preset: BillingPreset): BillingModel {
  return MODELS[preset.m] ?? (MODELS.hono as BillingModel);
}

/** Colonnes affichées (pour une facture BDG seule, on retire les colonnes de l'autre facture). */
export function visibleColumns(draft: Pick<BillingDraft, "preset" | "bdgType">): BillingColumn[] {
  const preset = presetById(draft.preset);
  const model = modelOf(preset);
  if (preset.m !== "bdgpair") return model.cols;
  if (draft.bdgType === "deb") return model.cols.filter((col) => !["pu", "ft"].includes(col.k));
  if (draft.bdgType === "fra") return model.cols.filter((col) => col.k !== "mt");
  return model.cols;
}

/** Intitulé d'une colonne (personnalisé par le préréglage le cas échéant). */
export function columnLabel(preset: BillingPreset, col: BillingColumn): string {
  return preset.cols?.[col.k] ?? (col.k === "des" && preset.colLbl ? preset.colLbl : col.l);
}

/** Calcule les colonnes calculées et les totaux (HT, TVA 19 %, TTC) d'une facture. */
export function computeBilling(draft: Pick<BillingDraft, "preset" | "rows" | "bdgType">): BillingComputation {
  const preset = presetById(draft.preset);
  const model = modelOf(preset);
  const rows: ComputedRow[] = draft.rows.map((row) => {
    const out: ComputedRow = { ...row };
    for (const col of model.cols) if (col.calc) out[col.k] = col.calc(row);
    return out;
  });
  let totals: BillingTotals;
  if (model.totals) {
    totals = model.totals(draft.rows.filter((row) => !row.info));
  } else {
    const base = model.htRows ? model.htRows(rows) : rows;
    const ht = r2(base.reduce((sum, row) => sum + num(row[model.ht ?? "ht"]), 0));
    const tva = r2(ht * 0.19);
    totals = { lines: [["TOTAL HT", ht], ["TVA 19 %", tva], ["TOTAL TTC", r2(ht + tva), true]], ht, tva, ttc: r2(ht + tva) };
  }
  if (preset.m === "bdgpair" && draft.bdgType !== "pair") {
    const debOnly = draft.bdgType === "deb";
    const part = (debOnly ? totals.deb : totals.fra) ?? { ht: 0, tva: 0, ttc: 0 };
    totals = {
      ...totals,
      lines: debOnly
        ? [["Débours HT", part.ht], ["TVA 19 %", part.tva], ["Facture débours TTC", part.ttc, true]]
        : [["Frais de gestion HT", part.ht], ["TVA 19 %", part.tva], ["Facture frais de gestion TTC", part.ttc, true]],
      ht: part.ht,
      tva: part.tva,
      ttc: part.ttc,
    };
  }
  return { rows, totals };
}

/** « 2026-09 » → « SEPTEMBRE 2026 ». */
export function periodLabel(month: string): string {
  const [year, mm] = month.split("-");
  const name = MONTHS_FR[Number(mm) - 1];
  return name && year ? `${name.toUpperCase()} ${year}` : "";
}

/** Prochain numéro « client » (« GAM 26-00057 ») à partir des numéros déjà utilisés. */
export function nextClientNumber(prefix: string, year: number, used: string[]): string {
  const yy = String(year).slice(2);
  const pattern = new RegExp(`${yy}\\s*-?\\s*0*(\\d{1,6})\\s*$`);
  let max = 0;
  for (const value of used) {
    const match = value.replace(/\s+/g, " ").match(pattern);
    if (match?.[1] && Number(match[1]) < 5000) max = Math.max(max, Number(match[1]));
  }
  return `${prefix.replace(/26/, yy)}${String(max + 1).padStart(5, "0")}`;
}

/** Prochains numéros BDG TRUST (« TRUST 012-2026 BDG ») — débours puis frais. */
export function nextTrustBdgNumbers(year: number, used: string[]): [string, string] {
  const pattern = new RegExp(`TRUST\\s*0*(\\d{1,4})\\s*[-/ ]\\s*${year}\\s*BDG`, "ig");
  let max = 0;
  for (const value of used) for (const match of value.matchAll(pattern)) max = Math.max(max, Number(match[1]));
  const make = (k: number): string => `TRUST ${String(max + k).padStart(3, "0")}-${year} BDG`;
  return [make(1), make(2)];
}

/** Prochains numéros BDG CAAT (« CAAT 26-41BDG ») — débours puis frais. */
export function nextCaatBdgNumbers(year: number, used: string[]): [string, string] {
  const yy = String(year).slice(2);
  const pattern = new RegExp(`${yy}\\s*-?\\s*0*(\\d{1,4})\\s*(?:&\\s*\\d+\\s*)?BDG`, "i");
  let max = 0;
  for (const value of used) {
    const match = value.match(pattern);
    if (match?.[1]) max = Math.max(max, Number(match[1]));
    const second = value.match(/&\s*(\d+)\s*BDG/i);
    if (second?.[1]) max = Math.max(max, Number(second[1]));
  }
  return [`CAAT ${yy}-${max + 1}BDG`, `CAAT ${yy}-${max + 2}BDG`];
}

/** Prochain numéro de facture globale BDG GAM (« 019-2026 AB »). */
export function nextGamAbNumber(year: number, used: string[]): string {
  const first = new RegExp(`AB\\s*0*(\\d{1,3})\\s*[-/]\\s*${year}`, "i");
  const second = new RegExp(`(?:^|\\D)0*(\\d{1,3})\\s*[-/ ]?\\s*${year}\\s*AB`, "i");
  let max = 0;
  for (const value of used) {
    const match = value.match(first) ?? value.match(second);
    if (match?.[1]) max = Math.max(max, Number(match[1]));
  }
  return `${String(max + 1).padStart(3, "0")}-${year} AB`;
}

/** Libellé de la ligne au suivi (« Honoraire … {P} »). */
export function trackingLabel(preset: BillingPreset, draft: BillingDraft): string {
  const dossiers = draft.rows.filter((row) => String(row.dos ?? "").trim()).length;
  return (preset.lib ?? "{O} {P}")
    .replace("{N}", dossiers ? String(dossiers) : "")
    .replace("{P}", draft.perTxt)
    .replace("{S}", draft.succ)
    .replace("{O}", draft.objet)
    .replace(/\s+/g, " ")
    .trim();
}

/** Lignes vides d'un préréglage. */
export function presetRows(preset: BillingPreset): BillingRow[] {
  return (preset.rows ?? [preset.row ?? {}]).map((row) => ({ ...row }));
}
