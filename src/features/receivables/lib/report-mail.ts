import { directionNature, type ImpayesReport, type ProductionStatus } from "@/features/receivables/lib/report";
import { MONTHS_FR } from "@/utils/dates";
import { formatDA } from "@/utils/format";
import { upperPlain } from "@/utils/text";

/** Montant en retard pour un mois de période. */
export interface LateMonth {
  /** Mois « AAAA-MM ». */
  key: string;
  amount: number;
}

/** Succursale en retard de règlement : factures émises depuis plus de `lateDays` jours, regroupées par mois. */
export interface LateBranch {
  label: string;
  count: number;
  amount: number;
  /** Mois en retard avec leur montant, du plus ancien au plus récent. */
  months: LateMonth[];
  /** Factures en retard dont le mois n'est pas indiqué. */
  withoutPeriod: { count: number; amount: number };
}

/** Mail préparé pour la direction. */
export interface ImpayesMail {
  subject: string;
  body: string;
  lateBranches: LateBranch[];
  lateCount: number;
  lateAmount: number;
  /** Montant des factures de la direction générale (hors mois) citées dans le mail. */
  directionAmount: number;
  /** Succursales dont la production du mois précédent n'est pas reçue. */
  productionLate: string[];
}

/** Délais de retard proposés (jours depuis la date de facture). */
export const LATE_DAYS_CHOICES: ReadonlyArray<30 | 60 | 90> = [30, 60, 90];

/** « 2026-09 » → « septembre 2026 » ; texte vide si le mois n'est pas valide. */
export function monthName(key: string): string {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(key);
  return match ? `${(MONTHS_FR[Number(match[2]) - 1] ?? "").toLowerCase()} ${match[1]}` : "";
}

/** « a, b et c ». */
export function joinFrench(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} et ${items[items.length - 1]}`;
}

const round2 = (value: number): number => Math.round(value * 100) / 100;
const validMonth = (key: string): boolean => /^\d{4}-(0[1-9]|1[0-2])$/.test(key);

/** Succursales ayant au moins une facture en retard (émise depuis plus de `lateDays` jours), hors factures de la direction générale, de la plus en retard (montant) à la moins. */
export function lateBranchesOf(report: ImpayesReport, lateDays: number): LateBranch[] {
  const result: LateBranch[] = [];
  for (const branch of report.branches) {
    const late = branch.invoices.filter((invoice) => invoice.ageDays !== null && invoice.ageDays > lateDays && directionNature(invoice.libelle) === null);
    if (late.length === 0) continue;
    const byMonth = new Map<string, number>();
    for (const invoice of late.filter((item) => validMonth(item.periode))) byMonth.set(invoice.periode, (byMonth.get(invoice.periode) ?? 0) + invoice.amount);
    const unknown = late.filter((invoice) => !validMonth(invoice.periode));
    result.push({
      label: branch.label,
      count: late.length,
      amount: round2(late.reduce((sum, invoice) => sum + invoice.amount, 0)),
      months: [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, amount]) => ({ key, amount: round2(amount) })),
      withoutPeriod: { count: unknown.length, amount: round2(unknown.reduce((sum, invoice) => sum + invoice.amount, 0)) },
    });
  }
  return result.sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label, "fr"));
}

/** « de octobre 2026 » s'écrit « d'octobre 2026 » : élision devant une voyelle. */
const deMois = (name: string): string => (/^[aeiouyéèêîô]/i.test(name) ? `d'${name}` : `de ${name}`);

/** Options du mail : réception de la production M-1 et noms d'affichage des succursales (clé → libellé). */
export interface MailOptions {
  production?: ProductionStatus | null;
  labels?: Record<string, string>;
}

/**
 * Prépare le mail à la directrice : objet, puis par succursale les mois de règlement en retard avec leur montant, les factures de la direction générale hors mois et les productions non reçues.
 * « En retard » = facture émise depuis plus de `lateDays` jours (ce délai n'est pas écrit dans le mail). `signer` : nom de l'expéditeur.
 */
export function buildImpayesMail(report: ImpayesReport, lateDays: number, signer: string, options: MailOptions = {}): ImpayesMail {
  const production = options.production ?? null;
  const labels = options.labels ?? {};
  const keys = production ? Object.keys(production.byBranch) : Object.keys(labels);
  const display = (label: string): string => {
    const key = keys.find((candidate) => upperPlain(label).includes(candidate));
    return (key ? labels[key] : undefined) ?? label;
  };
  const late = lateBranchesOf(report, lateDays).map((branch) => ({ ...branch, label: display(branch.label) }));
  const lateCount = late.reduce((sum, branch) => sum + branch.count, 0);
  const lateAmount = round2(late.reduce((sum, branch) => sum + branch.amount, 0));
  const direction = new Map<string, number>();
  for (const invoice of report.branches.flatMap((branch) => branch.invoices)) {
    const nature = directionNature(invoice.libelle);
    if (nature) direction.set(nature, (direction.get(nature) ?? 0) + invoice.amount);
  }
  const directionAmount = round2([...direction.values()].reduce((sum, value) => sum + value, 0));
  const productionLate = production ? Object.entries(production.byBranch).filter(([, state]) => !state.received).map(([key]) => labels[key] ?? key) : [];
  const monthLabel = monthName(report.asOf.slice(0, 7));
  const subject = `Allo Assistance : règlements et productions en attente, ${monthLabel}`;
  const lines: string[] = ["Bonjour Madame,", ""];
  if (late.length === 0 && direction.size === 0 && productionLate.length === 0) {
    lines.push(`Je vous écris pour vous confirmer qu'à ce jour, tous les règlements et toutes les productions de ${report.company} sont à jour. Je vous remercie.`);
  } else {
    lines.push("Je vous écris au sujet des règlements en retard et des productions non reçues. Vous trouverez ci-dessous, succursale par succursale, les mois concernés. Le rapport détaillé est joint à ce mail.");
    if (late.length > 0) {
      lines.push("", "Règlements en retard :");
      for (const branch of late) {
        lines.push("", branch.label);
        for (const month of branch.months) lines.push(`- ${monthName(month.key)} : ${formatDA(month.amount)}`);
        if (branch.withoutPeriod.count > 0) lines.push(`- mois non indiqué : ${formatDA(branch.withoutPeriod.amount)}`);
      }
      lines.push("", `Total des règlements en retard : ${formatDA(lateAmount)}.`);
    }
    if (direction.size > 0) {
      lines.push("", "Factures de la direction générale (hors mois) :");
      for (const [nature, amount] of direction) lines.push(`- ${nature} : ${formatDA(round2(amount))}`);
    }
    if (productionLate.length > 0 && production) {
      lines.push("", "Productions non reçues :");
      for (const label of productionLate) lines.push(`- ${label} : production ${deMois(monthName(production.month))}`);
    }
    const asks: string[] = [];
    if (late.length > 0 || direction.size > 0) asks.push("faire régler ces factures, ou de nous indiquer la date prévue du règlement");
    if (productionLate.length > 0) asks.push("demander aux succursales concernées de nous envoyer leur production");
    lines.push("", `Je vous remercie de bien vouloir ${asks.join(", et de ")}. Je reste à votre disposition pour toute précision.`);
  }
  lines.push("", "Cordialement,", signer || "", "Allo Assistance");
  return { subject, body: lines.join("\n"), lateBranches: late, lateCount, lateAmount, directionAmount, productionLate };
}
