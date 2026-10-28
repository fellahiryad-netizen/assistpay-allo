import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { can, requireAccess } from "@/features/access/services/access-rules";
import type { AuthUser } from "@/features/access/types";
import type { AmountBucket, DashboardData, MonthlyFlow } from "@/features/dashboard/types";
import { decimalToNumber } from "@/features/invoices/services/invoice-mapper";
import { visibleSens } from "@/features/invoices/services/invoice-rules";
import { fail, ok, type ActionResult } from "@/types";
import { daysBetween, toIsoDate, todayIso } from "@/utils/dates";

const TOP = 8;
const AGING_LIMITS: ReadonlyArray<{ label: string; max: number }> = [
  { label: "0 – 30 jours", max: 30 },
  { label: "31 – 60 jours", max: 60 },
  { label: "61 – 90 jours", max: 90 },
  { label: "91 – 180 jours", max: 180 },
  { label: "Plus de 180 jours", max: Number.POSITIVE_INFINITY },
];

interface MonthlyRow {
  month: string;
  sens: "CREDIT" | "DEBIT";
  total: number;
}

function lastMonths(todayIsoDate: string, count: number): string[] {
  const [year, month] = todayIsoDate.split("-").map(Number) as [number, number];
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(year, month - 1 - (count - 1 - index), 1));
    return date.toISOString().slice(0, 7);
  });
}

/**
 * Indicateurs du tableau de bord : créances clients et dettes fournisseurs en attente,
 * flux du mois, ancienneté des créances et flux des 12 derniers mois.
 * Seuls les sens visibles par l'utilisateur sont calculés ; la paie exige l'accès RH.
 */
export async function getDashboard(actor: AuthUser): Promise<ActionResult<DashboardData>> {
  const guard = requireAccess(actor, "DASH");
  if (!guard.success) return guard;
  const sens = visibleSens(actor);
  const showCredit = sens.includes("CREDIT");
  const showDebit = sens.includes("DEBIT");
  const payroll: Prisma.InvoiceWhereInput = can(actor, "RH") ? {} : { payroll: false };
  const today = todayIso();
  const months = lastMonths(today, 12);
  const firstMonth = `${months[0] ?? today.slice(0, 7)}-01`;

  try {
    const [credits, payablesByTiers, monthlyRows] = await Promise.all([
      showCredit
        ? db.invoice.findMany({
            where: { ...payroll, sens: "CREDIT", status: "EN_ATTENTE" },
            select: { categorie: true, montant: true, dateFacture: true, dateOperation: true },
          })
        : Promise.resolve([]),
      showDebit
        ? db.invoice.groupBy({
            by: ["tiers"],
            where: { ...payroll, sens: "DEBIT", status: "EN_ATTENTE" },
            _sum: { montant: true },
            _count: { _all: true },
          })
        : Promise.resolve([]),
      db.$queryRaw<MonthlyRow[]>(Prisma.sql`
        SELECT to_char(date_trunc('month', "dateOperation"), 'YYYY-MM') AS month,
               "sens"::text AS sens,
               COALESCE(SUM("montant"), 0)::float8 AS total
        FROM "Invoice"
        WHERE "status" = 'REGLE'
          AND "dateOperation" >= ${firstMonth}::date
          AND "sens"::text = ANY(${sens})
          AND (${can(actor, "RH")} OR "payroll" = false)
        GROUP BY 1, 2`),
    ]);

    const byCategory = new Map<string, AmountBucket>();
    const aging: AmountBucket[] = AGING_LIMITS.map((limit) => ({ label: limit.label, amount: 0, count: 0 }));
    let receivablesTotal = 0;
    for (const row of credits) {
      const amount = decimalToNumber(row.montant);
      receivablesTotal += amount;
      const label = row.categorie || "Sans catégorie";
      const bucket = byCategory.get(label) ?? { label, amount: 0, count: 0 };
      bucket.amount += amount;
      bucket.count += 1;
      byCategory.set(label, bucket);
      const since = toIsoDate(row.dateFacture ?? row.dateOperation);
      const age = since ? Math.max(0, daysBetween(since, today)) : 0;
      const index = AGING_LIMITS.findIndex((limit) => age <= limit.max);
      const target = aging[index === -1 ? aging.length - 1 : index];
      if (target) {
        target.amount += amount;
        target.count += 1;
      }
    }

    const payables = payablesByTiers
      .map((row) => ({ label: row.tiers || "Sans tiers", amount: decimalToNumber(row._sum.montant) ?? 0, count: row._count._all }))
      .sort((a, b) => b.amount - a.amount);

    const flows = new Map<string, MonthlyFlow>(months.map((month) => [month, { month, encaisse: 0, decaisse: 0 }]));
    for (const row of monthlyRows) {
      const flow = flows.get(row.month);
      if (!flow) continue;
      if (row.sens === "CREDIT") flow.encaisse = row.total;
      else flow.decaisse = row.total;
    }
    const monthly = [...flows.values()];
    const current = flows.get(today.slice(0, 7)) ?? { month: today.slice(0, 7), encaisse: 0, decaisse: 0 };

    return ok({
      asOf: today,
      showCredit,
      showDebit,
      receivables: {
        total: receivablesTotal,
        count: credits.length,
        byCategory: [...byCategory.values()].sort((a, b) => b.amount - a.amount).slice(0, TOP),
      },
      payables: {
        total: payables.reduce((sum, item) => sum + item.amount, 0),
        count: payables.reduce((sum, item) => sum + item.count, 0),
        byTiers: payables.slice(0, TOP),
      },
      currentMonth: current,
      aging,
      monthly,
    });
  } catch (error) {
    console.error("[dashboard] calcul impossible :", error);
    return fail("Le tableau de bord n'a pas pu être calculé.", "DATABASE");
  }
}
