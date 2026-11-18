import { writeWorkbook, type SheetToWrite } from "@/lib/spreadsheet";
import { requireAccess } from "@/features/access/services/access-rules";
import type { AuthUser } from "@/features/access/types";
import { CLIENTS, ISSUER, num, presetById } from "@/features/billing/config";
import { periodLabel, computeBilling } from "@/features/billing/services/billing-calc";
import type { BillingClientInfo, BillingDraft } from "@/features/billing/types";
import { fail, ok, type ActionResult } from "@/types";
import { amountInWords } from "@/utils/amounts";

/** Fichier Excel généré. */
export interface GamDetailFile {
  name: string;
  bytes: Uint8Array;
}

/** Une facture globale GAM : son type (feuille) et le brouillon enregistré. */
export interface GamDetailInput {
  kind: "CONV" | "TAKAFUL";
  draft: BillingDraft;
}

const FIRST_ROW = 15;
const COLUMNS = ["N°Dossier", "Matricule", "Nom Client", "Agence", "Préstation", "Produit", "Date", "N° sinistre", "Prix HT", "TVA 19%", "Prix TTC"] as const;

const frDate = (iso: string): string => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.split("-").reverse().join("/") : iso);
const plain = (text: string): string => text.normalize("NFD").replace(/[̀-ͯ]/g, "");

/** N° de sinistre numérique quand c'est possible (comme dans le fichier d'exemple), sinon le texte lu. */
function claim(value: string | undefined): string | number {
  const text = String(value ?? "").trim();
  return /^\d{1,15}$/.test(text) ? Number(text) : text;
}

/**
 * Feuilles « détail » d'après des factures globales GAM déjà chargées : une feuille par facture (CONV, TAKAFUL),
 * sur le modèle du fichier GAM_CONV-TAKAFUL : en-tête émetteur / client, tableau des dossiers, total HT, TVA 19 %, TTC et montant en lettres.
 * Les totaux reprennent le calcul de la facture (computeBilling), sans règle propre.
 */
export function buildGamDetailSheets(inputs: readonly GamDetailInput[]): SheetToWrite[] {
  return inputs.map(({ kind, draft }) => {
    const rows = draft.rows.filter((row) => Object.entries(row).some(([key, value]) => key !== "info" && String(value ?? "").trim()));
    const totals = computeBilling({ preset: draft.preset, rows, bdgType: draft.bdgType }).totals;
    const base = CLIENTS.GAM ?? { nom: "", adresse: "", tel: "", rc: "", nif: "", nis: "" };
    const client: BillingClientInfo = { ai: "", ...base, ...Object.fromEntries(Object.entries(draft.cli).filter(([, value]) => value)) };
    const company = plain(client.nom).toUpperCase();
    const last = FIRST_ROW + Math.max(rows.length, 1) - 1;
    const htRow = last + 2;
    const grid: SheetToWrite["rows"] = [];
    const put = (row: number, col: number, value: SheetToWrite["rows"][number][number]): void => {
      while (grid.length < row) grid.push([]);
      const line = grid[row - 1] ?? [];
      while (line.length <= col) line.push(null);
      line[col] = value;
      grid[row - 1] = line;
    };
    const emitter = [ISSUER.nom, ISSUER.adresse, `Tel: ${ISSUER.tel}`, `N°RC: ${ISSUER.rc}`, `N°IF: ${ISSUER.nif}`];
    emitter.forEach((text, index) => put(index + 1, 0, text));
    const addressee = [
      "Adressé à",
      `Entreprise: ${company}`,
      `Succursale: ${company}`,
      `Adresse: ${client.adresse}`,
      `Tel No: ${client.tel}`,
      "Email: ",
      `N°RC: ${client.rc}`,
      `N°IF: ${client.nif}`,
      `N° AI: ${client.ai}`,
      `NIS: ${client.nis}`,
    ];
    addressee.forEach((text, index) => put(index + 1, 4, text));
    put(11, 0, `Date: ${frDate(draft.date)}`);
    put(12, 0, kind === "CONV" ? "Facture  CONVENTIONNEL" : "Facture  TAKAFUL");
    put(13, 0, `N°: ${draft.num}${draft.perTxt || draft.per ? `   Période : ${draft.perTxt || periodLabel(draft.per)}` : ""}`);
    COLUMNS.forEach((label, index) => put(14, index, label));
    rows.forEach((row, index) => {
      const at = FIRST_ROW + index;
      put(at, 0, row.dos ?? "");
      put(at, 1, row.mat ?? "");
      put(at, 2, row.nom ?? "");
      put(at, 3, row.ag ?? "");
      put(at, 4, "glass");
      put(at, 5, row.pres ?? "");
      put(at, 6, row.dt ?? "");
      put(at, 7, claim(row.sin));
      const prix = num(row.prix);
      const exact = (value: number): number => Math.round(value * 1e6) / 1e6;
      put(at, 8, prix);
      // Comme dans le modèle remis au partenaire : TVA et prix total ligne par ligne (HT × 19 %, puis HT + TVA).
      put(at, 9, { f: `I${at}*19%`, v: exact(prix * 0.19) });
      put(at, 10, { f: `J${at}+I${at}`, v: exact(prix * 1.19) });
    });
    put(htRow, 7, "Total HT");
    put(htRow, 8, { f: `SUM(I${FIRST_ROW}:I${last})`, v: totals.ht });
    put(htRow + 1, 7, "TVA 19%");
    put(htRow + 1, 8, { f: `+I${htRow}*0.19`, v: totals.tva });
    put(htRow + 2, 7, "Total TTC");
    put(htRow + 2, 8, { f: `SUM(I${htRow}:I${htRow + 1})`, v: totals.ttc });
    put(htRow + 4, 0, "La présente facture est arrêtée à la somme de:");
    put(htRow + 5, 0, amountInWords(totals.ttc));
    put(htRow + 6, 0, "Règlement par chèque ou virement sur le compte suivant:");
    put(htRow + 7, 0, `(RIB): ${ISSUER.rib}`);
    return { name: kind, rows: grid, widths: [18.7, 18, 34, 26, 12, 30, 12, 16, 16, 14, 16] };
  });
}

/**
 * Classeur « détail » des factures globales BDG GAM établies (feuilles CONV et TAKAFUL), à joindre aux deux factures.
 * Au moins une facture ; chacune doit être de modèle « BDG GAM – facture globale ».
 */
export async function exportGamDetail(actor: AuthUser, ids: { conv?: string; takaful?: string }): Promise<ActionResult<GamDetailFile>> {
  const guard = requireAccess(actor, "FACT");
  if (!guard.success) return guard;
  const wanted = (["CONV", "TAKAFUL"] as const).flatMap((kind) => {
    const id = kind === "CONV" ? ids.conv : ids.takaful;
    return id ? [{ kind, id }] : [];
  });
  if (wanted.length === 0) return fail("Indiquez au moins une facture globale GAM.", "VALIDATION");
  // Chargés à l'appel : la construction des feuilles (pure) reste utilisable et testable sans base de données.
  const { getIssued } = await import("@/features/billing/services/billing-service");
  const { logAction } = await import("@/features/journal/services/journal-service");
  const inputs: GamDetailInput[] = [];
  for (const { kind, id } of wanted) {
    const issued = await getIssued(actor, id);
    if (!issued.success) return issued;
    if (presetById(issued.data.draft.preset).m !== "bdggam") return fail(`La facture ${issued.data.draft.num} n'est pas une facture globale BDG GAM.`, "VALIDATION");
    inputs.push({ kind, draft: issued.data.draft });
  }
  const per = inputs[0]?.draft.per ?? "";
  const month = periodLabel(per);
  const label = plain(month).replace(/\s+/g, "_") || "PERIODE";
  const kinds = inputs.map((input) => input.kind).join("-");
  await logAction(actor, "Export Excel détail BDG GAM", inputs.map((input) => input.draft.num).join(" / "));
  return ok({ name: `GAM_${kinds}_${label}.xlsx`, bytes: writeWorkbook(buildGamDetailSheets(inputs)) });
}
