import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, Hourglass, Wallet } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BarList } from "@/features/dashboard/components/bar-list";
import { KpiCard } from "@/features/dashboard/components/kpi-card";
import { MonthlyFlowChart } from "@/features/dashboard/components/monthly-flow-chart";
import type { DashboardData } from "@/features/dashboard/types";
import { formatDA, formatDate } from "@/utils/format";

/** Propriétés de la vue du tableau de bord. */
export interface DashboardViewProps {
  data: DashboardData;
}

/** Tableau de bord : indicateurs, classements, ancienneté des créances et flux mensuels. */
export function DashboardView({ data }: Readonly<DashboardViewProps>): React.JSX.Element {
  const agingTotal = data.aging.reduce((sum, bucket) => sum + bucket.amount, 0);
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {data.showCredit ? (
          <KpiCard label="Créances clients en attente" amount={data.receivables.total} detail={`${data.receivables.count} facture(s) à encaisser`} icon={Hourglass} />
        ) : null}
        {data.showDebit ? (
          <KpiCard label="Fournisseurs à payer" amount={data.payables.total} detail={`${data.payables.count} facture(s) en attente`} icon={Wallet} />
        ) : null}
        {data.showCredit ? (
          <KpiCard label="Encaissé ce mois-ci" amount={data.currentMonth.encaisse} detail={`Factures clients réglées · ${data.currentMonth.month}`} icon={ArrowDownLeft} />
        ) : null}
        {data.showDebit ? (
          <KpiCard label="Décaissé ce mois-ci" amount={data.currentMonth.decaisse} detail={`Factures fournisseurs réglées · ${data.currentMonth.month}`} icon={ArrowUpRight} />
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {data.showCredit ? (
          <Card>
            <CardHeader>
              <CardTitle>Créances par client</CardTitle>
              <CardDescription>Factures clients en attente, par catégorie</CardDescription>
            </CardHeader>
            <CardContent>
              <BarList items={data.receivables.byCategory} emptyLabel="Aucune créance en attente." />
              <Link href="/factures?sens=CREDIT&status=EN_ATTENTE" className="mt-4 inline-block text-sm font-medium text-primary hover:underline">
                Voir les factures clients en attente
              </Link>
            </CardContent>
          </Card>
        ) : null}
        {data.showDebit ? (
          <Card>
            <CardHeader>
              <CardTitle>Fournisseurs à payer</CardTitle>
              <CardDescription>Factures fournisseurs en attente, par tiers</CardDescription>
            </CardHeader>
            <CardContent>
              <BarList items={data.payables.byTiers} emptyLabel="Aucune facture fournisseur en attente." />
              <Link href="/factures?sens=DEBIT&status=EN_ATTENTE" className="mt-4 inline-block text-sm font-medium text-primary hover:underline">
                Voir les factures fournisseurs en attente
              </Link>
            </CardContent>
          </Card>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Flux réglés sur 12 mois</CardTitle>
            <CardDescription>Selon la date de règlement</CardDescription>
          </CardHeader>
          <CardContent>
            <MonthlyFlowChart data={data.monthly} showCredit={data.showCredit} showDebit={data.showDebit} />
          </CardContent>
        </Card>
        {data.showCredit ? (
          <Card>
            <CardHeader>
              <CardTitle>Ancienneté des créances</CardTitle>
              <CardDescription>Depuis la date de facture, au {formatDate(data.asOf)}</CardDescription>
            </CardHeader>
            <CardContent>
              <table className="w-full text-sm">
                <tbody>
                  {data.aging.map((bucket) => (
                    <tr key={bucket.label} className="border-b last:border-0">
                      <th scope="row" className="py-2 text-left font-normal">
                        {bucket.label}
                        <span className="ml-1 text-xs text-muted-foreground">({bucket.count})</span>
                      </th>
                      <td className="py-2 text-right tabular-nums">{formatDA(bucket.amount)}</td>
                      <td className="w-14 py-2 text-right text-xs tabular-nums text-muted-foreground">
                        {agingTotal > 0 ? `${Math.round((bucket.amount / agingTotal) * 100)} %` : "–"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
