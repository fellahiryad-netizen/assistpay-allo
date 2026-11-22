import { readFile } from "node:fs/promises";
import path from "node:path";
import type { AuthUser } from "@/features/access/types";
import { logAction } from "@/features/journal/services/journal-service";
import { buildDeck } from "@/features/treasury/lib/deck";
import { drawDeck, type DeckAssets } from "@/features/treasury/lib/deck-pdf";
import type { TreasuryQuery } from "@/features/treasury/schemas";
import { requireTreasury } from "@/features/treasury/services/treasury-access";
import { getTreasuryView } from "@/features/treasury/services/treasury-service";
import type { TreasuryView } from "@/features/treasury/types/view";
import { fail, ok, type ActionResult } from "@/types";

async function readAsset(file: string): Promise<Uint8Array | null> {
  try {
    return new Uint8Array(await readFile(path.join(process.cwd(), "public", file)));
  } catch {
    return null;
  }
}

/** Fabrique le PDF de présentation (A4 paysage) d'une vue déjà lue. Pure hors lecture du logo : utilisée par l'export et par les tests. */
export async function renderTreasuryPdf(view: TreasuryView, assets: DeckAssets, generatedAt: string): Promise<{ bytes: Uint8Array; pages: number } | null> {
  const deck = buildDeck(view);
  if (!deck) return null;
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4", compress: true });
  doc.setProperties({ title: "Situation de trésorerie - CONFIDENTIEL", subject: "Trésorerie du compte AGB", author: "Allo Assistance" });
  drawDeck(doc, deck, view, assets, generatedAt);
  return { bytes: new Uint8Array(doc.output("arraybuffer")), pages: deck.pages.length };
}

/**
 * Export PDF « présentation » de la trésorerie (A4 paysage, une rubrique par page, pour la direction).
 * Même contrôle d'accès que la page (Administrateur, Direction, Comptable) ; le scénario présenté est celui de l'utilisateur qui exporte.
 * Écrit au journal d'administration.
 */
export async function exportTreasuryPdf(actor: AuthUser, query: TreasuryQuery): Promise<ActionResult<{ name: string; bytes: Uint8Array; pages: number }>> {
  const guard = requireTreasury(actor, "view");
  if (!guard.success) return guard;
  const view = await getTreasuryView(actor, query, "export");
  if (!view.success) return view;
  try {
    const [logo, footer] = await Promise.all([readAsset("logo-allo.png"), readAsset("etats/pied.png")]);
    const rendered = await renderTreasuryPdf(view.data, { logo, footer }, view.data.generatedAt);
    if (!rendered) return fail("Aucun solde n'est disponible : importez d'abord un relevé AGB.", "NOT_FOUND");
    await logAction(actor, "Export PDF de la trésorerie", `${view.data.active ? `mode simulation : scénario « ${view.data.active.nom} »` : "situation réelle"}, ${rendered.pages} pages`, true);
    return ok({ name: `tresorerie_${view.data.today}.pdf`, bytes: rendered.bytes, pages: rendered.pages });
  } catch (error) {
    console.error("[tresorerie] export PDF :", error);
    return fail("Le PDF n'a pas pu être généré.");
  }
}
