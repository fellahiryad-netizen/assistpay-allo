import { DonutChart } from "@/components/common/donut-chart";
import { StateMessage } from "@/components/common/state-message";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AgingStackChart } from "@/features/receivables/components/aging-stack-chart";
import { AttentionPoints } from "@/features/receivables/components/attention-points";
import { ReceivableDetailPanel } from "@/features/receivables/components/receivables-detail-panel";
import { ReceivablesKpis } from "@/features/receivables/components/receivables-kpis";
import { ReceivablesTable } from "@/features/receivables/components/receivables-table";
import { logoMapOf } from "@/features/receivables/config/logos";
import { companySlug } from "@/features/receivables/lib/company";
import { companyColor } from "@/features/receivables/lib/colors";
import type { ReceivablesQuery } from "@/features/receivables/schemas";
import type { ReceivableDetail, ReceivablesSummary } from "@/features/receivables/types";
import { formatDate } from "@/utils/format";

/** Vue complète des créances : indicateurs, anneau, tableau par compagnie, graphique d'ancienneté, points d'attention. */
export function ReceivablesView({ summary, query, detail, canExport, canRelance }: Readonly<{ summary: ReceivablesSummary; query: ReceivablesQuery; detail: ReceivableDetail | null; canExport: boolean; canRelance: boolean }>): React.JSX.Element {
  if (summary.count === 0) {
    return <StateMessage kind="empty" title="Aucune créance en attente" message="Aucune facture partenaire en attente ne correspond à ces filtres." />;
  }
  const slices = summary.companies.map((row) => ({ label: row.company, amount: row.amount, count: row.count }));
  const colors = Object.fromEntries(summary.companies.map((row) => [row.company, companyColor(row.company)]));
  return (
    <div className="flex flex-col gap-5">
      <ReceivablesKpis summary={summary} />
      <Card>
        <CardHeader>
          <CardTitle>Répartition de la créance par compagnie</CardTitle>
          <CardDescription>Factures partenaires en attente au {formatDate(summary.asOf)}</CardDescription>
        </CardHeader>
        <CardContent>
          <DonutChart slices={slices} centerLabel="Créance totale" colors={colors} idPrefix="creances" maxParts={12} logos={logoMapOf(summary.companies.map((row) => row.company), companySlug)} />
        </CardContent>
      </Card>
      <section aria-labelledby="creances-table">
        <h2 id="creances-table" className="mb-2 text-base font-semibold">
          Détail par compagnie
        </h2>
        <ReceivablesTable summary={summary} query={query} selected={detail?.scope ?? null} />
      </section>
      <Card>
        <CardHeader>
          <CardTitle>Ancienneté par compagnie</CardTitle>
          <CardDescription>Depuis la date de facture, au {formatDate(summary.asOf)}</CardDescription>
        </CardHeader>
        <CardContent>
          <AgingStackChart summary={summary} />
        </CardContent>
      </Card>
      <AttentionPoints summary={summary} />
      {detail ? <ReceivableDetailPanel detail={detail} query={query} canExport={canExport} canRelance={canRelance} /> : null}
    </div>
  );
}
