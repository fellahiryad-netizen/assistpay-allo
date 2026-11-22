import { writeWorkbook, type SheetToWrite } from "@/lib/spreadsheet";
import type { AuthUser } from "@/features/access/types";
import { logAction } from "@/features/journal/services/journal-service";
import { buildDeck } from "@/features/treasury/lib/deck";
import { duplicatesSentence } from "@/features/treasury/lib/duplicates-notice";
import { MINIMUM_LABEL, minimumExplanation } from "@/features/treasury/lib/minimum";
import { NATURE_LABELS } from "@/features/treasury/lib/payables";
import { COMPANIES } from "@/features/treasury/lib/receivables";
import type { TreasuryQuery } from "@/features/treasury/schemas";
import { requireTreasury } from "@/features/treasury/services/treasury-access";
import { getTreasuryView } from "@/features/treasury/services/treasury-service";
import { SIM_MODE_LABELS, SIM_TYPE_LABELS } from "@/features/treasury/types";
import { fail, ok, type ActionResult } from "@/types";
import { formatDate } from "@/utils/format";

const SOURCE_LABELS = { facture: "Facture", simulation: "Simulation", demande: "Demande sans facture liée" } as const;

/** Date `AAAA-MM-JJ` en cellule date (format JJ/MM/AAAA appliqué à l'écriture). */
const day = (iso: string): Date => new Date(`${iso}T00:00:00Z`);

/**
 * Export Excel de la trésorerie, sept onglets lisibles : Synthèse, Échéancier, Chronologie (jour par jour), Chèques en circulation,
 * Hypothèses et contrôles, Simulation (si un scénario est actif pour l'utilisateur qui exporte) et Encaissements attendus.
 * Montants en DA à deux décimales. Même contrôle d'accès que la page ; une ligne au journal d'administration.
 */
export async function exportTreasury(actor: AuthUser, query: TreasuryQuery): Promise<ActionResult<{ name: string; bytes: Uint8Array }>> {
  const guard = requireTreasury(actor, "view");
  if (!guard.success) return guard;
  const view = await getTreasuryView(actor, query, "export");
  if (!view.success) return view;
  const { computation, balance } = view.data;
  const deck = buildDeck(view.data);
  if (!computation || !balance || !deck) return fail("Aucun solde n'est disponible : importez d'abord un relevé AGB.", "NOT_FOUND");
  const active = view.data.active;
  const simulated = active ? `MODE SIMULATION : scénario « ${active.nom} » (${active.lignes.length} ligne(s)). Ces chiffres ne sont pas la situation réelle.` : "Situation réelle";
  const coverage = computation.coverageDays;

  const synthese: SheetToWrite = {
    name: "Synthèse",
    widths: [46, 24, 78],
    moneyCols: [1],
    rows: [
      ["Trésorerie du compte AGB - CONFIDENTIEL", formatDate(view.data.today)],
      [simulated],
      [],
      ["Indicateur", "Valeur (DA)", "Explication"],
      ["Solde du compte AGB (relevé)", computation.bank, `Arrêté au ${formatDate(balance.date)}${balance.lastOperationDate ? `, dernière opération du ${formatDate(balance.lastOperationDate)}` : ""} - ${balance.sourceLabel}`],
      ["Chèques émis non débités (déduits)", -computation.chequesTotal, `${view.data.cheques.length} chèque(s) en circulation`],
      ["Mouvements du CRM postérieurs au relevé", computation.adjustment, "Non confirmés par le relevé"],
      ["Solde disponible estimé", computation.available, "Solde du relevé moins les chèques en circulation"],
      ["Reste à payer (factures fournisseurs en attente)", computation.invoicesTotal, "Somme des restes à payer"],
      ["Paiements simulés comptés", computation.simulationTotal, active ? `Scénario « ${active.nom} »` : "Aucune simulation"],
      ["Demandes sans facture liée comptées", computation.requestsTotal, view.data.includeRequests ? "Incluses à la demande" : "Non comptées par défaut"],
      ["Solde après paiements", computation.balanceAfter, computation.verdict.title],
      ["Taux de couverture (disponible ÷ total à payer)", computation.coverageRatio === null ? "sans objet" : Math.round(computation.coverageRatio * 100) / 100, "Supérieur à 1 : tout peut être payé"],
      [
        "Jours de couverture",
        coverage === null ? "sans objet" : Math.max(0, Math.round(coverage * 10) / 10),
        coverage === null ? "Historique insuffisant" : coverage < 0 ? "0 : le solde après paiements est négatif, la couverture est épuisée" : "Solde après paiements ÷ décaissement moyen journalier",
      ],
      [MINIMUM_LABEL, computation.cushion, minimumExplanation(computation)],
      ["Point bas de la chronologie", computation.timeline.lowest.balance, formatDate(computation.timeline.lowest.date)],
      ["Premier découvert", computation.timeline.overdraftDate ? formatDate(computation.timeline.overdraftDate) : "aucun", ""],
      ["Dont déjà dans des virements préparés", computation.preparedTotal, `${computation.preparedCount} lot(s) en attente, non additionnés`],
      [],
      ...(view.data.duplicates
        ? [
            ["ATTENTION - doublons possibles", view.data.duplicates.total, `${duplicatesSentence(view.data.duplicates.count)} Solde après paiements sans ces lignes : ${view.data.duplicates.balanceAfterWithout} DA`],
            ...view.data.duplicates.lines.map((line) => [`   ${line.libelle}`, line.montant, `${formatDate(line.date)} : ${line.messages.join(" ")}`]),
            [],
          ]
        : []),
      ["NIVEAU", deck.essentiel.word, computation.verdict.title],
      ["Verdict", computation.verdict.sentence],
      [],
      [deck.hypotheses.mention],
    ],
  };

  const schedule: SheetToWrite = {
    name: "Échéancier",
    widths: [12, 34, 44, 30, 18, 24, 20],
    moneyCols: [4, 6],
    rows: [
      ...(active ? [[simulated], []] : []),
      ["Date prévue", "Bénéficiaire", "Libellé", "Nature", "Montant (DA)", "Source", "Solde après paiement (DA)"],
      ...computation.schedule.map((row) => [day(row.date), row.beneficiaire, row.libelle, NATURE_LABELS[row.nature], row.montant, `${SOURCE_LABELS[row.source]}${row.source === "simulation" ? (row.certain ? " (montant certain)" : " (estimation)") : ""}`, row.balanceAfter]),
      [],
      ["Totaux par nature", "", "", "", "Montant (DA)"],
      ...computation.byNature.map((row) => [row.label, "", `${row.count} paiement(s)`, "", row.total]),
    ],
  };

  const paidByDay = new Map<string, number>();
  for (const row of computation.schedule) paidByDay.set(row.date, Math.round(((paidByDay.get(row.date) ?? 0) + row.montant) * 100) / 100);
  const withExpected = computation.timeline.points.some((point) => point.expected !== null);
  const chronology: SheetToWrite = {
    name: "Chronologie",
    widths: [12, 30, 24, 28, 28],
    moneyCols: [2, 3, 4],
    rows: [
      ...(active ? [[simulated], []] : []),
      ["Date", "Nature du point", "Solde (DA)", "Paiements du jour (DA)", withExpected ? "Avec encaissements attendus (DA)" : ""],
      ...view.data.history.map((point) => [day(point.d), "Réel (relevé)", point.b, "", ""]),
      ...computation.timeline.points.map((point) => [day(point.date), point.date === computation.timeline.lowest.date ? "Prévu : point bas" : "Prévu (sans encaissement)", point.balance, paidByDay.get(point.date) ?? "", point.expected ?? ""]),
    ],
  };

  const cheques: SheetToWrite = {
    name: "Chèques en circulation",
    widths: [18, 34, 14, 18, 20, 44],
    moneyCols: [3],
    rows: [
      ["Chèques émis non encore débités par la banque (déduits du solde)"],
      ["N° du chèque", "Bénéficiaire", "Émis le", "Montant (DA)", "Origine", "Libellé"],
      ...view.data.cheques.map((cheque) => [cheque.numero, cheque.beneficiaire, cheque.date ? day(cheque.date) : "sans date", cheque.montant, cheque.source === "rh" ? "RH" : "Facture", cheque.libelle]),
      ["TOTAL", "", "", computation.chequesTotal],
      [],
      ["Chèques à vérifier (non déduits : sans date ou trop anciens)"],
      ["N° du chèque", "Bénéficiaire", "Date", "Montant (DA)", "Origine", "Libellé"],
      ...view.data.controls.chequesToVerify.map((cheque) => [cheque.numero, cheque.beneficiaire, cheque.date ? day(cheque.date) : "sans date", cheque.montant, cheque.source === "rh" ? "RH" : "Facture", cheque.libelle]),
    ],
  };

  const notes: SheetToWrite = {
    name: "Hypothèses et contrôles",
    widths: [34, 110],
    rows: [
      ["Hypothèses retenues"],
      ...deck.hypotheses.lines.map((line) => ["", line]),
      [],
      ["Définitions"],
      ...deck.hypotheses.definitions.map(([term, definition]) => [term, definition]),
      [],
      ["Ce qui est compté"],
      ...deck.hypotheses.counted.map((line) => ["", line]),
      ["Ce qui n'est pas compté"],
      ...deck.hypotheses.notCounted.map((line) => ["", line]),
      [],
      ["Points de contrôle"],
      ...deck.cheques.points.map((line) => ["", line]),
      [],
      [deck.hypotheses.mention],
    ],
  };

  const sheets: SheetToWrite[] = [synthese, schedule, chronology, cheques, notes];
  if (active && deck.simulation) {
    sheets.push({
      name: "Simulation",
      widths: [18, 40, 12, 20, 14, 14, 16],
      moneyCols: [3],
      rows: [
        [simulated],
        [],
        ["Type", "Libellé", "Date", "Montant (DA)", "Mode", "Certitude", "Compté ?"],
        ...active.lignes.map((line) => [SIM_TYPE_LABELS[line.type], line.libelle, day(line.date), line.montant, SIM_MODE_LABELS[line.mode], line.certitude === "CERTAIN" ? "certain" : "estimation", line.decision === "ignorer" ? "non (écarté)" : "oui"]),
        [],
        ["Solde après paiements avant la simulation", "", "", deck.simulation.before],
        ["Lignes simulées retirées", "", "", deck.simulation.total],
        ["Solde après paiements après la simulation", "", "", deck.simulation.after],
      ],
    });
  }
  if (computation.expected.rows.length > 0) {
    sheets.push({
      name: "Encaissements attendus",
      widths: [14, 12, 20, 18, 14, 16, 30],
      moneyCols: [2, 5],
      rows: [
        ["Compagnie", "Factures", "Créances en attente (DA)", "Délai médian (jours)", "Échantillon", "Retenu après décote (DA)", "Statut"],
        ...computation.expected.rows
          .slice()
          .sort((a, b) => COMPANIES.indexOf(a.company) - COMPANIES.indexOf(b.company))
          .map((row) => [row.company, row.count, row.total, row.medianDays ?? "n.d.", row.sample, row.counted, view.data.settings.encaissementsAttendus ? "attendu, non garanti" : "non compté (scénario prudent)"]),
      ],
    });
  }
  const bytes = writeWorkbook(sheets);
  await logAction(actor, "Export Excel de la trésorerie", `${active ? `mode simulation : scénario « ${active.nom} »` : "situation réelle"}, ${computation.schedule.length} paiements à venir`, true);
  return ok({ name: `tresorerie_${view.data.today}.xlsx`, bytes });
}
