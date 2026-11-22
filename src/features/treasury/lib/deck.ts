import { formatDA, formatDate } from "@/utils/format";
import { AGB_ACCOUNT, SIM_MODE_LABELS, SIM_TYPE_LABELS, type SimType } from "@/features/treasury/types";
import { buildHypotheses, DECISION_AID_MENTION } from "@/features/treasury/lib/hypotheses";
import { withExact } from "@/features/treasury/lib/format";
import { MINIMUM_LABEL } from "@/features/treasury/lib/minimum";
import { priorityGroups, type PayNature, type PayableItem } from "@/features/treasury/lib/payables";
import type { RiskLevel } from "@/features/treasury/lib/risk";
import type { TreasuryView } from "@/features/treasury/types/view";

/** Identifiants des pages de la présentation PDF, dans l'ordre. */
export type DeckPageId = "garde" | "essentiel" | "solde" | "reste" | "evolution" | "paiements" | "simulation" | "cheques" | "hypotheses";

/** Mots écrits en toutes lettres pour chaque niveau (jamais la couleur seule). */
export const LEVEL_WORDS: Readonly<Record<RiskLevel, string>> = { vert: "VERT", orange: "ORANGE", rouge: "ROUGE", indetermine: "INDÉTERMINÉ" };

export { withExact };

/** Indicateur de la page « L'essentiel ». */
export interface DeckKpi {
  label: string;
  /** Montant exact, deux décimales. */
  value: string;
  /** Explication en une phrase pour un lecteur non comptable. */
  hint: string;
}

/** Part du reste à payer. */
export interface DeckPart {
  label: string;
  total: number;
  count: number;
  /** Part du total, 0 à 100. */
  share: number;
}

/** Contenu de la présentation, entièrement calculé (aucun dessin). */
export interface Deck {
  /** Pages dans l'ordre ; la page Simulation n'existe que si le scénario actif a des lignes. */
  pages: Array<{ id: DeckPageId; title: string; retenir: string }>;
  scenario: { nom: string; lines: number } | null;
  cover: { subtitle: string; balanceDate: string; today: string };
  essentiel: { kpis: DeckKpi[]; level: RiskLevel; word: string; title: string; sentence: string };
  solde: { facts: Array<[string, string, string]>; checks: Array<{ label: string; ok: boolean; explanation: string }> | null; freshness: string; freshnessLevel: "ok" | "orange" | "rouge" };
  reste: { total: number; parts: DeckPart[]; payees: Array<{ name: string; total: number; count: number; oldestDays: number | null }>; aging: Array<{ label: string; total: number; count: number }>; othersCount: number };
  paiements: { groups: Array<{ label: string; total: number; count: number; share: number }>; order: Array<{ label: string; count: number; total: number }>; total: number; notes: string[]; mention: string };
  simulation: {
    lines: Array<{ type: string; libelle: string; date: string; montant: number; mode: string; certitude: string; counted: boolean }>;
    total: number;
    before: number;
    after: number;
    coverageBefore: number | null;
    coverageAfter: number | null;
    duplicates: string | null;
  } | null;
  cheques: { circulation: Array<{ numero: string; beneficiaire: string; date: string; montant: number }>; total: number; toVerify: Array<{ numero: string; beneficiaire: string; date: string; montant: number }>; points: string[] };
  hypotheses: { definitions: Array<[string, string]>; counted: string[]; notCounted: string[]; lines: string[]; mention: string };
}

const MAX_PAYEES = 8;

function groupLabel(nature: PayNature): "Fournisseurs" | "Fiscal et social" | "Salaires" | "Autres" {
  if (nature === "assistance" || nature === "bdg") return "Fournisseurs";
  if (nature === "fiscal" || nature === "social") return "Fiscal et social";
  return nature === "salaire" ? "Salaires" : "Autres";
}

const pct = (part: number, total: number): number => (total > 0 ? Math.round((part / total) * 1000) / 10 : 0);

/** Tranches d'ancienneté des factures en attente. */
export function agingBuckets(items: readonly PayableItem[]): Array<{ label: string; total: number; count: number }> {
  const buckets = [
    { label: "30 jours ou moins", test: (age: number) => age <= 30 },
    { label: "31 à 60 jours", test: (age: number) => age > 30 && age <= 60 },
    { label: "61 à 90 jours", test: (age: number) => age > 60 && age <= 90 },
    { label: "Plus de 90 jours", test: (age: number) => age > 90 },
  ];
  const rows = buckets.map((bucket) => {
    const list = items.filter((item) => item.ageDays !== null && bucket.test(item.ageDays));
    return { label: bucket.label, total: Math.round(list.reduce((sum, item) => sum + item.montant, 0) * 100) / 100, count: list.length };
  });
  const unknown = items.filter((item) => item.ageDays === null);
  if (unknown.length > 0) rows.push({ label: "Date de facture inconnue", total: Math.round(unknown.reduce((sum, item) => sum + item.montant, 0) * 100) / 100, count: unknown.length });
  return rows;
}

/** Plus gros prestataires en attente (factures seulement), du plus gros au plus petit. */
export function topPayees(items: readonly PayableItem[], limit = MAX_PAYEES): Array<{ name: string; total: number; count: number; oldestDays: number | null }> {
  const map = new Map<string, { name: string; total: number; count: number; oldestDays: number | null }>();
  for (const item of items) {
    const key = item.beneficiaire.trim().toUpperCase();
    const entry = map.get(key) ?? { name: item.beneficiaire.trim(), total: 0, count: 0, oldestDays: null };
    entry.total = Math.round((entry.total + item.montant) * 100) / 100;
    entry.count += 1;
    if (item.ageDays !== null) entry.oldestDays = entry.oldestDays === null ? item.ageDays : Math.max(entry.oldestDays, item.ageDays);
    map.set(key, entry);
  }
  return [...map.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)).slice(0, limit);
}

/**
 * Construit la présentation PDF de la trésorerie depuis la vue de l'utilisateur qui exporte (son scénario actif, jamais celui d'un autre).
 * Pure : aucun dessin, aucune lecture de base. Renvoie null s'il n'y a pas de solde.
 */
export function buildDeck(view: TreasuryView): Deck | null {
  const { balance, computation } = view;
  if (!balance || !computation) return null;
  const level = computation.verdict.level;
  const scenario = view.active ? { nom: view.active.nom, lines: view.active.lignes.length } : null;
  const invoices = computation.schedule.filter((item) => item.source === "facture");
  const invoicesTotal = computation.invoicesTotal;
  const partOf = (label: string, nature: (item: PayableItem) => boolean): DeckPart => {
    const list = invoices.filter(nature);
    const total = Math.round(list.reduce((sum, item) => sum + item.montant, 0) * 100) / 100;
    return { label, total, count: list.length, share: pct(total, invoicesTotal) };
  };
  const parts = [partOf("Assistance routière", (item) => item.nature === "assistance"), partOf("BDG (bris de glace)", (item) => item.nature === "bdg"), partOf("Autres fournisseurs", (item) => item.nature !== "assistance" && item.nature !== "bdg")];
  const payees = topPayees(invoices);
  const distinctPayees = new Set(invoices.map((item) => item.beneficiaire.trim().toUpperCase())).size;
  const perDay = computation.reference?.perDay ?? 0;

  const pages: Deck["pages"] = [
    { id: "garde", title: "Situation de trésorerie", retenir: "" },
    {
      id: "essentiel",
      title: "L'essentiel en une page",
      retenir: `Le compte AGB affiche ${withExact(computation.bank)}. Une fois les chèques émis non encore débités retirés, il reste ${withExact(computation.available)} de disponible ; après avoir payé tout ce qui est en attente, il resterait ${withExact(computation.balanceAfter)}.`,
    },
    {
      id: "solde",
      title: "D'où vient le solde",
      retenir: balance.source === "releve" ? `Le solde est lu dans le relevé AGB importé, arrêté au ${formatDate(balance.date)} : ce n'est pas un calcul du CRM.` : `Ce solde a été saisi à la main au ${formatDate(balance.date)} : il doit être remplacé par un relevé AGB importé.`,
    },
    {
      id: "reste",
      title: "Ce qu'il reste à payer",
      retenir: `${invoices.length} facture${invoices.length > 1 ? "s" : ""} de fournisseurs attendent un règlement pour ${withExact(invoicesTotal)}${payees[0] ? ` ; le plus gros prestataire est ${payees[0].name} (${withExact(payees[0].total)})` : ""}.`,
    },
    {
      id: "evolution",
      title: "Évolution du solde",
      retenir: computation.timeline.overdraftDate
        ? `Si tout est payé aux dates prévues et sans aucun encaissement, le compte passerait à découvert le ${formatDate(computation.timeline.overdraftDate)}.`
        : `Si tout est payé aux dates prévues et sans aucun encaissement, le point le plus bas serait de ${withExact(computation.timeline.lowest.balance)} le ${formatDate(computation.timeline.lowest.date)}, sans découvert.`,
    },
    {
      id: "paiements",
      title: "Paiements à venir",
      retenir: `${computation.schedule.length} paiement${computation.schedule.length > 1 ? "s" : ""} sont prévus pour un total de ${withExact(computation.totalToPay)}.`,
    },
  ];
  const simulated = view.active && view.active.lignes.length > 0 ? view.active : null;
  if (simulated) {
    pages.push({
      id: "simulation",
      title: "Simulation CNAS, G50 et salaires",
      retenir: `Ces lignes sont des hypothèses saisies par la comptable (scénario « ${simulated.nom} »), pas des paiements enregistrés. Elles retirent ${withExact(computation.simulationTotal)} au solde après paiements.`,
    });
  }
  pages.push(
    {
      id: "cheques",
      title: "Chèques en circulation et points de contrôle",
      retenir: view.cheques.length > 0 ? `${view.cheques.length} chèque${view.cheques.length > 1 ? "s" : ""} émis (${withExact(computation.chequesTotal)}) ne sont pas encore débités par la banque : ils sont déjà retirés du solde disponible.` : "Aucun chèque émis n'attend d'être débité par la banque.",
    },
    { id: "hypotheses", title: "Hypothèses et lecture des chiffres", retenir: "Ces définitions expliquent chaque chiffre. Rien n'est compté en double, et aucun encaissement n'est ajouté en scénario prudent." },
  );

  const checks = view.controls.checks;
  const cheqRow = (cheque: { numero: string; beneficiaire: string; date: string | null; montant: number }): { numero: string; beneficiaire: string; date: string; montant: number } => ({ numero: cheque.numero, beneficiaire: cheque.beneficiaire, date: cheque.date ? formatDate(cheque.date) : "sans date", montant: cheque.montant });
  const points: string[] = [];
  if (view.controls.ledger) points.push(`Écart entre le relevé et le journal du CRM : ${formatDA(view.controls.ledger.gap)} sur ${view.controls.ledger.crmLines} lignes.`);
  if (view.controls.posterior.count > 0) points.push(`${view.controls.posterior.count} mouvement${view.controls.posterior.count > 1 ? "s" : ""} du CRM postérieur${view.controls.posterior.count > 1 ? "s" : ""} au relevé (${formatDA(view.controls.posterior.total)}), non confirmé${view.controls.posterior.count > 1 ? "s" : ""} par la banque, ajouté${view.controls.posterior.count > 1 ? "s" : ""} au disponible.`);
  if (view.controls.unmatched.debitCount + view.controls.unmatched.creditCount > 0) points.push(`${view.controls.unmatched.debitCount + view.controls.unmatched.creditCount} ligne(s) du relevé restent à rapprocher dans le CRM.`);
  if (view.controls.hrAnomaliesTotal > 0) points.push(`${view.controls.hrAnomaliesTotal} écriture(s) RH sans date ou à date absurde : elles faussent la détection des doublons.`);
  if (view.controls.pendingWithCheque > 0) points.push(`${view.controls.pendingWithCheque} facture(s) en attente portent un numéro de chèque : elles restent dans le reste à payer.`);
  if (view.controls.gaps.length > 0) points.push(`Trous de plus de 7 jours dans le relevé : ${view.controls.gaps.join(" ; ")}.`);
  if (view.rejection) points.push(`Dernier relevé refusé (${view.rejection.fileName}) : ${view.rejection.message}`);
  if (view.duplicates) points.push(`${view.duplicates.count} ligne(s) simulée(s) signalée(s) comme doublon possible, comptée(s) : ${formatDA(view.duplicates.total)}.`);
  if (points.length === 0) points.push("Aucun point de contrôle à signaler.");

  const simBefore = Math.round((computation.balanceAfter + computation.simulationTotal) * 100) / 100;
  return {
    pages,
    scenario,
    cover: { subtitle: `Compte AGB n° ${AGB_ACCOUNT} — solde arrêté au ${formatDate(balance.date)}`, balanceDate: balance.date, today: view.today },
    essentiel: {
      kpis: [
        { label: "Solde du compte AGB", value: formatDA(computation.bank), hint: "Ce que la banque indique sur le relevé." },
        { label: "Disponible après chèques en circulation", value: formatDA(computation.available), hint: "Solde moins les chèques émis que la banque n'a pas encore débités." },
        { label: "Reste à payer", value: formatDA(computation.totalToPay), hint: "Factures fournisseurs en attente de règlement" + (computation.simulationTotal > 0 ? ", plus la simulation." : ".") },
        { label: "Solde après paiements", value: formatDA(computation.balanceAfter), hint: "Ce qu'il resterait en banque une fois tout payé." },
        { label: "Couverture", value: computation.coverageDays === null ? "non calculable" : `${Math.max(0, Math.round(computation.coverageDays * 10) / 10).toString().replace(".", ",")} jours`, hint: computation.coverageDays === null ? "Historique du relevé insuffisant." : "Nombre de jours de dépenses habituelles que ce solde permet de couvrir." },
        { label: MINIMUM_LABEL, value: computation.minimumMode === "montant" || computation.reference ? formatDA(computation.cushion) : "non calculable", hint: computation.minimumMode === "montant" ? "Montant fixé par la direction : en dessous, le niveau passe en Orange." : `${computation.cushionDays} jours de dépenses habituelles à garder en banque.` },
      ],
      level,
      word: LEVEL_WORDS[level],
      title: computation.verdict.title,
      sentence: computation.verdict.sentence,
    },
    solde: {
      facts: [
        ["Source", balance.sourceLabel + (balance.source === "releve" && balance.fileName ? ` (fichier ${balance.fileName})` : ""), "D'où le chiffre est pris."],
        ["Solde arrêté au", formatDate(balance.date), "Date du solde de fin lue dans le relevé."],
        ["Dernière opération", balance.lastOperationDate ? formatDate(balance.lastOperationDate) : "non renseignée", "Date de la dernière ligne du relevé."],
        ["Importé", balance.savedBy ? `par ${balance.savedBy}` : "", "Qui a déposé le relevé dans le CRM."],
        ["Solde AGB", formatDA(computation.bank), "Solde de fin du relevé."],
      ],
      checks: checks
        ? [
            { label: "Formule du solde", ok: checks.formula, explanation: "Solde de départ + crédits − débits = solde de fin." },
            { label: "Dernière ligne", ok: checks.lastLine, explanation: "Le solde après la dernière opération est égal au solde de fin." },
            { label: "Enchaînement des lignes", ok: checks.chain, explanation: "Chaque ligne repart du solde de la ligne précédente : aucune ligne manquante." },
          ]
        : null,
      freshness:
        balance.source === "manuel"
          ? "Solde saisi à la main : à remplacer par un relevé importé."
          : balance.freshness === "ok"
            ? `Relevé à jour (${balance.workingDays} jour${balance.workingDays > 1 ? "s" : ""} ouvré${balance.workingDays > 1 ? "s" : ""} depuis la date du solde).`
            : `${balance.freshness === "rouge" ? "RELEVÉ TRÈS ANCIEN" : "RELEVÉ ANCIEN"} : ${balance.workingDays} jours ouvrés depuis la date du solde. Importer un relevé plus récent.`,
      freshnessLevel: balance.source === "manuel" ? "orange" : balance.freshness,
    },
    reste: { total: invoicesTotal, parts, payees, aging: agingBuckets(invoices), othersCount: Math.max(0, distinctPayees - payees.length) },
    paiements: (() => {
      const total = computation.totalToPay;
      const labels = ["Fournisseurs", "Fiscal et social", "Salaires", "Autres"] as const;
      const groups = labels
        .map((label) => {
          const list = computation.schedule.filter((item) => groupLabel(item.nature) === label);
          const sum = Math.round(list.reduce((s, item) => s + item.montant, 0) * 100) / 100;
          return { label: label === "Fournisseurs" ? "Fournisseurs (assistance, BDG, autres factures)" : label, total: sum, count: list.length, share: pct(sum, total) };
        })
        .filter((group) => group.count > 0);
      const notes = ["Les factures dont l'échéance n'est pas fixée sont supposées payées à la date du solde : c'est l'hypothèse la plus prudente."];
      if (!groups.some((group) => group.label === "Fiscal et social" || group.label === "Salaires")) notes.push("Aucune obligation fiscale ou sociale (G50, IRG, CNAS) ni aucun salaire n'est inscrit dans l'échéancier : la comptable peut les ajouter dans une simulation.");
      if (computation.preparedCount > 0) notes.push(`${computation.preparedCount} lot(s) de virements déjà préparés (${formatDA(computation.preparedTotal)}) portent sur ces mêmes factures : ils ne sont pas comptés une seconde fois.`);
      return { groups, order: priorityGroups(computation.schedule).map((group) => ({ label: group.label, count: group.count, total: group.total })), total, notes, mention: DECISION_AID_MENTION };
    })(),
    simulation: simulated
      ? {
          lines: simulated.lignes.map((line) => ({ type: SIM_TYPE_LABELS[line.type as SimType], libelle: line.libelle, date: formatDate(line.date), montant: line.montant, mode: SIM_MODE_LABELS[line.mode], certitude: line.certitude === "CERTAIN" ? "certain" : "estimation", counted: line.decision !== "ignorer" })),
          total: computation.simulationTotal,
          before: simBefore,
          after: computation.balanceAfter,
          coverageBefore: perDay > 0 ? Math.max(0, simBefore / perDay) : null,
          coverageAfter: perDay > 0 ? Math.max(0, computation.balanceAfter / perDay) : null,
          duplicates: view.duplicates ? `${view.duplicates.count} ligne(s) signalée(s) comme doublon possible, comptée(s) tant qu'elle(s) ne sont pas écartée(s) : ${formatDA(view.duplicates.total)}.` : null,
        }
      : null,
    cheques: { circulation: view.cheques.map(cheqRow), total: computation.chequesTotal, toVerify: view.controls.chequesToVerify.map(cheqRow), points },
    hypotheses: {
      definitions: [
        ["Solde disponible", "Solde du relevé moins les chèques émis non encore débités (les chèques déjà débités sont dans le solde)."],
        ["Reste à payer", "Somme de ce qu'il reste à régler sur les factures fournisseurs en attente."],
        ["Solde après paiements", "Solde disponible moins le reste à payer : ce qui resterait si tout était payé."],
        ["Couverture en jours", "Solde après paiements divisé par la dépense moyenne par jour : combien de jours le compte tiendrait au rythme habituel."],
        [MINIMUM_LABEL, computation.minimumMode === "montant" ? `Montant fixé par la direction, ${formatDA(computation.cushion)} : le solde après paiements ne doit pas descendre en dessous.` : `${computation.cushionDays} jours de dépenses moyennes (moyenne des derniers mois complets du relevé, mois de 30 jours).`],
        ["Point bas", "Le solde le plus bas atteint jour après jour, une fois chaque paiement retiré à sa date."],
        ["Niveau", "Vert : au moins égal au minimum de trésorerie. Orange : sous le minimum sans être négatif. Rouge : découvert prévu. Indéterminé : historique insuffisant (mode en jours seulement)."],
      ],
      counted: ["Le solde du relevé AGB.", "Les chèques émis non débités, retirés du solde.", "Le reste à payer des factures fournisseurs en attente.", ...(simulated ? ["Les lignes de la simulation active, signalées comme telles."] : [])],
      notCounted: [
        view.settings.encaissementsAttendus ? "Les encaissements attendus ne sont qu'indicatifs : jamais dans le solde ni le niveau." : "Aucun encaissement : scénario prudent.",
        "Les virements préparés et les demandes de paiement liées à une facture (pas de double comptage).",
        view.includeRequests ? "Demandes sans facture liée : comptées à la demande de l'utilisateur." : "Les demandes de paiement sans facture liée (information).",
      ],
      lines: buildHypotheses({ balance, computation, scenarioName: scenario?.nom ?? null, scenarioLines: scenario?.lines ?? 0, expectedEnabled: view.settings.encaissementsAttendus, includeRequests: view.includeRequests }),
      mention: DECISION_AID_MENTION,
    },
  };
}
