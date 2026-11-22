import { writeWorkbook, type SheetToWrite } from "@/lib/spreadsheet";
import type { AuthUser } from "@/features/access/types";
import { logAction } from "@/features/journal/services/journal-service";
import { COMPANIES } from "@/features/treasury/lib/receivables";
import { NATURE_LABELS } from "@/features/treasury/lib/payables";
import type { TreasuryQuery } from "@/features/treasury/schemas";
import { requireTreasury } from "@/features/treasury/services/treasury-access";
import { getTreasuryView } from "@/features/treasury/services/treasury-service";
import { duplicatesSentence } from "@/features/treasury/lib/duplicates-notice";
import { DECISION_AID_MENTION } from "@/features/treasury/lib/hypotheses";
import { fail, ok, type ActionResult } from "@/types";
import { formatDate } from "@/utils/format";

const SOURCE_LABELS = { facture: "Facture", simulation: "Simulation", demande: "Demande sans facture liée" } as const;

/**
 * Export Excel de la trésorerie : indicateurs (avec hypothèses) et échéancier des paiements à venir, plus les encaissements attendus.
 * Même contrôle d'accès que la page (Administrateur, Direction, Comptable). Écrit au journal d'administration.
 */
export async function exportTreasury(actor: AuthUser, query: TreasuryQuery): Promise<ActionResult<{ name: string; bytes: Uint8Array }>> {
  const guard = requireTreasury(actor, "view");
  if (!guard.success) return guard;
  const view = await getTreasuryView(actor, query, "export");
  if (!view.success) return view;
  const { computation, balance } = view.data;
  if (!computation || !balance) return fail("Aucun solde n'est disponible : importez d'abord un relevé AGB.", "NOT_FOUND");
  const simulated = view.data.active ? `MODE SIMULATION : scénario « ${view.data.active.nom} »` : "Situation réelle";
  const indicators: SheetToWrite = {
    name: "Indicateurs",
    widths: [46, 24, 60],
    rows: [
      ["Trésorerie du compte AGB", formatDate(view.data.today), simulated],
      [],
      ["Solde du compte AGB (relevé)", computation.bank, `arrêté au ${formatDate(balance.date)}${balance.lastOperationDate ? `, dernière opération du ${formatDate(balance.lastOperationDate)}` : ""} — ${balance.sourceLabel}`],
      ["Chèques émis non débités (déduits)", -computation.chequesTotal, `${view.data.cheques.length} chèque(s) en circulation`],
      ["Mouvements du CRM postérieurs au relevé", computation.adjustment, "non confirmés par le relevé"],
      ["Solde disponible estimé", computation.available, ""],
      ["Reste à payer (factures fournisseurs en attente)", computation.invoicesTotal, ""],
      ["Paiements simulés comptés", computation.simulationTotal, simulated],
      ["Demandes sans facture liée comptées", computation.requestsTotal, view.data.includeRequests ? "incluses à la demande" : "non comptées par défaut"],
      ["Solde après paiements", computation.balanceAfter, computation.verdict.title],
      ["Taux de couverture", computation.coverageRatio === null ? "sans objet" : Math.round(computation.coverageRatio * 100) / 100, ""],
      [
        "Jours de couverture",
        computation.coverageDays === null ? "sans objet" : Math.max(0, Math.round(computation.coverageDays * 10) / 10),
        computation.coverageDays === null ? "historique insuffisant" : computation.coverageDays < 0 ? "0 : le solde après paiements est négatif, la couverture est épuisée" : "solde après paiements ÷ décaissement moyen journalier",
      ],
      [`Réserve conseillée (${computation.cushionDays} jours)`, computation.cushion, computation.reference ? `moyenne mensuelle ${Math.round(computation.reference.perMonth)} DA sur ${computation.reference.months.length} mois complets` : "historique insuffisant"],
      ["Point bas de la chronologie", computation.timeline.lowest.balance, formatDate(computation.timeline.lowest.date)],
      ["Premier découvert", computation.timeline.overdraftDate ? formatDate(computation.timeline.overdraftDate) : "aucun", ""],
      ["Dont déjà dans des virements préparés", computation.preparedTotal, `${computation.preparedCount} lot(s) en attente, non additionnés`],
      [],
      ...(view.data.duplicates
        ? [
            ["ATTENTION — doublons possibles", duplicatesSentence(view.data.duplicates.count), `Impact : ${view.data.duplicates.total} DA dans le reste à payer ; solde après paiements sans ces lignes : ${view.data.duplicates.balanceAfterWithout} DA`],
            ...view.data.duplicates.lines.map((line) => [`   ${line.libelle}`, line.montant, `${formatDate(line.date)} : ${line.messages.join(" ")}`]),
            [],
          ]
        : []),
      ["Verdict", computation.verdict.sentence],
      [],
      [DECISION_AID_MENTION],
    ],
  };
  const schedule: SheetToWrite = {
    name: "Échéancier",
    widths: [12, 34, 44, 30, 18, 24, 20],
    rows: [
      ...(view.data.active ? [[`${simulated} — les paiements simulés de ce scénario sont mêlés aux factures.`], []] : []),
      ["Date prévue", "Bénéficiaire", "Libellé", "Nature", "Montant", "Source", "Solde après paiement"],
      ...computation.schedule.map((row) => [formatDate(row.date), row.beneficiaire, row.libelle, NATURE_LABELS[row.nature], row.montant, `${SOURCE_LABELS[row.source]}${row.source === "simulation" ? (row.certain ? " (montant certain)" : " (estimation)") : ""}`, row.balanceAfter]),
      [],
      ["Totaux par nature"],
      ...computation.byNature.map((row) => [row.label, "", `${row.count} paiement(s)`, "", row.total, "", ""]),
    ],
  };
  const sheets: SheetToWrite[] = [indicators, schedule];
  if (computation.expected.rows.length > 0) {
    sheets.push({
      name: "Encaissements attendus",
      widths: [14, 12, 20, 18, 14, 16, 22],
      rows: [
        ["Compagnie", "Factures", "Créances en attente", "Délai médian (jours)", "Échantillon", "Retenu après décote", "Statut"],
        ...computation.expected.rows
          .slice()
          .sort((a, b) => COMPANIES.indexOf(a.company) - COMPANIES.indexOf(b.company))
          .map((row) => [row.company, row.count, row.total, row.medianDays ?? "n.d.", row.sample, row.counted, view.data.settings.encaissementsAttendus ? "attendu, non garanti" : "non compté (scénario prudent)"]),
      ],
    });
  }
  const bytes = writeWorkbook(sheets);
  await logAction(actor, "Export de la trésorerie", `${view.data.active ? `scénario ${view.data.active.nom}` : "situation réelle"}, ${computation.schedule.length} paiements à venir`, true);
  return ok({ name: `tresorerie_${view.data.today}.xlsx`, bytes });
}
