import type { TreasuryComputation } from "@/features/treasury/lib/compute";
import type { BalanceView } from "@/features/treasury/types/view";
import { formatDA, formatDate } from "@/utils/format";

/** Mention obligatoire de l'ordre de paiement conseillé. */
export const DECISION_AID_MENTION = "Aide à la décision. L'ordre de paiement relève de la décision de la direction.";

/** Mention de bas de page. */
export const FOOTER_MENTION = "Aide à la décision, ne constitue pas un conseil financier.";

/** Texte des hypothèses retenues, toujours affiché (écran, impression, export). */
export function buildHypotheses(input: {
  balance: BalanceView;
  computation: TreasuryComputation;
  scenarioName: string | null;
  scenarioLines: number;
  expectedEnabled: boolean;
  includeRequests: boolean;
}): string[] {
  const { balance, computation } = input;
  const lines: string[] = [];
  lines.push(
    balance.source === "releve"
      ? `Le solde vient du relevé AGB importé, arrêté au ${formatDate(balance.date)}. Il n'est jamais recalculé depuis le journal du CRM.`
      : `Solde saisi à la main (${balance.sourceLabel}) au ${formatDate(balance.date)} : à remplacer dès qu'un relevé valide est importé.`,
  );
  lines.push(
    input.expectedEnabled
      ? "Les encaissements attendus sont montrés à part (pointillés), avec 20 % de décote : ils sont attendus, non garantis, et ne changent ni le solde après paiements ni le niveau de risque."
      : "Aucun encaissement n'est compté.",
  );
  lines.push("Les chèques émis non débités sont retranchés du solde bancaire (chèque cherché au relevé par son numéro, puis par un débit de même montant à ± 10 jours).");
  lines.push("Le reste à payer est la somme des restes des factures fournisseurs en attente. Les paiements du CRM (demandes de paiement, virements préparés) ne sont pas comptés deux fois.");
  lines.push(
    input.includeRequests
      ? `Les ${computation.requestsInfo.count} demandes de paiement sans facture liée sont comptées, à la demande de l'utilisateur (à confirmer).`
      : `Les ${computation.requestsInfo.count} demandes de paiement sans facture liée ne sont pas comptées (information).`,
  );
  lines.push(
    computation.minimumMode === "montant"
      ? `Minimum de trésorerie : montant fixe de ${formatDA(computation.cushion)}, fixé par la direction. Le niveau est Vert si le solde après paiements reste au moins égal à ce minimum, Orange s'il passe en dessous sans être négatif, Rouge en cas de découvert.`
      : computation.reference
        ? `Minimum de trésorerie : ${computation.cushionDays} jours de décaissements moyens (moyenne des ${computation.reference.months.length} derniers mois complets du relevé, mois de 30 jours).`
        : `Minimum de trésorerie : ${computation.cushionDays} jours de décaissements moyens ; l'historique du relevé ne permet pas de le calculer.`,
  );
  lines.push("Les factures sans échéance fixée sont supposées payées à la date du solde (hypothèse la plus prudente).");
  lines.push(input.scenarioName ? `Simulation active : « ${input.scenarioName} », ${input.scenarioLines} ligne(s) saisie(s) par la comptable, jamais enregistrées dans les factures, les demandes ni le RH.` : "Aucune simulation n'est active : situation réelle.");
  return lines;
}
