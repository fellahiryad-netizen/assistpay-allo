import type { ImpayesReport } from "@/features/receivables/lib/report";
import { MONTHS_FR } from "@/utils/dates";
import { formatDA, formatDate } from "@/utils/format";

/** Succursale en retard : factures émises depuis plus de `lateDays` jours et mois concernés. */
export interface LateBranch {
  label: string;
  count: number;
  amount: number;
  /** Mois (AAAA-MM) de période des factures en retard, du plus ancien au plus récent. */
  months: string[];
  /** Factures en retard dont la période n'est pas indiquée. */
  withoutPeriod: number;
  /** Ancienneté de la plus ancienne facture en retard (jours). */
  oldestDays: number;
}

/** Mail préparé pour la direction. */
export interface ImpayesMail {
  subject: string;
  body: string;
  lateBranches: LateBranch[];
  lateCount: number;
  lateAmount: number;
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

/** Succursales ayant au moins une facture en retard (émise depuis plus de `lateDays` jours), de la plus en retard (montant) à la moins. */
export function lateBranchesOf(report: ImpayesReport, lateDays: number): LateBranch[] {
  const result: LateBranch[] = [];
  for (const branch of report.branches) {
    const late = branch.invoices.filter((invoice) => invoice.ageDays !== null && invoice.ageDays > lateDays);
    if (late.length === 0) continue;
    const months = [...new Set(late.map((invoice) => (/^\d{4}-(0[1-9]|1[0-2])$/.test(invoice.periode) ? invoice.periode : "")).filter(Boolean))].sort();
    result.push({
      label: branch.label,
      count: late.length,
      amount: Math.round(late.reduce((sum, invoice) => sum + invoice.amount, 0) * 100) / 100,
      months,
      withoutPeriod: late.filter((invoice) => !/^\d{4}-(0[1-9]|1[0-2])$/.test(invoice.periode)).length,
      oldestDays: Math.max(...late.map((invoice) => invoice.ageDays ?? 0)),
    });
  }
  return result.sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label, "fr"));
}

/** Ligne d'une succursale dans le mail. */
function branchLine(branch: LateBranch): string {
  const names = branch.months.map(monthName).filter(Boolean);
  const parts = [`${branch.label} : ${branch.count} facture${branch.count > 1 ? "s" : ""} pour ${formatDA(branch.amount)}`];
  if (names.length > 0) parts.push(`${names.length > 1 ? "mois en retard" : "mois en retard"} : ${joinFrench(names)}`);
  if (branch.withoutPeriod > 0) parts.push(`${branch.withoutPeriod} facture${branch.withoutPeriod > 1 ? "s" : ""} sans mois indiqué`);
  return `- ${parts.join(". ")}.`;
}

/**
 * Prépare le mail à la direction : objet, texte avec la liste des succursales en retard et, pour chacune, les mois en retard.
 * « En retard » = facture émise depuis plus de `lateDays` jours. `signer` : nom de l'expéditeur pour la signature.
 */
export function buildImpayesMail(report: ImpayesReport, lateDays: number, signer: string): ImpayesMail {
  const late = lateBranchesOf(report, lateDays);
  const lateCount = late.reduce((sum, branch) => sum + branch.count, 0);
  const lateAmount = Math.round(late.reduce((sum, branch) => sum + branch.amount, 0) * 100) / 100;
  const date = formatDate(report.asOf);
  const subject = `Factures Allo Assistance en attente de règlement - situation au ${date}`;
  const lines: string[] = ["Bonjour,", ""];
  if (report.count === 0) {
    lines.push(`Au ${date}, toutes les factures Allo Assistance sont réglées. Je vous remercie.`);
  } else {
    lines.push(`Je vous envoie la situation, au ${date}, des factures Allo Assistance que la ${report.company} n'a pas encore réglées. Le rapport détaillé est joint à ce mail.`, "");
    lines.push(`Au total, ${report.count} facture${report.count > 1 ? "s" : ""} restent à régler, pour ${formatDA(report.total)}.`);
    if (late.length === 0) {
      lines.push(`Aucune n'a plus de ${lateDays} jours : aucune succursale n'est en retard pour le moment.`);
    } else {
      lines.push(`Parmi elles, ${lateCount} facture${lateCount > 1 ? "s" : ""} (${formatDA(lateAmount)}) ${lateCount > 1 ? "ont" : "a"} été émise${lateCount > 1 ? "s" : ""} il y a plus de ${lateDays} jours. Voici les succursales concernées et les mois en retard :`, "");
      for (const branch of late) lines.push(branchLine(branch));
      lines.push("", "Je vous remercie de bien vouloir demander à ces succursales de régler ces factures dès que possible, ou de nous indiquer la date prévue du règlement. Pour toute précision sur une facture, je reste à votre disposition.");
    }
  }
  lines.push("", "Cordialement,", signer || "", "Allo Assistance");
  return { subject, body: lines.join("\n"), lateBranches: late, lateCount, lateAmount };
}
