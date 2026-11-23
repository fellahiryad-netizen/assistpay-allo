import Link from "next/link";
import { CompanyLogo } from "@/features/receivables/components/company-logo";
import { AGING_BUCKETS } from "@/features/receivables/lib/aging";
import { ACTIVITY_KEYS } from "@/features/receivables/lib/aggregate";
import { ACTIVITY_LABELS } from "@/features/receivables/lib/company";
import { scopeKey } from "@/features/receivables/lib/detail";
import { companyColor } from "@/features/receivables/lib/colors";
import { invoicesHref, receivablesHref } from "@/features/receivables/lib/links";
import type { ReceivablesQuery } from "@/features/receivables/schemas";
import type { DetailScope, ReceivablesSummary } from "@/features/receivables/types";
import { formatDA, formatDate } from "@/utils/format";

const pct = (value: number): string => `${value.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
const th = "whitespace-nowrap px-3 py-2 text-right text-xs font-medium text-muted-foreground";
const td = "whitespace-nowrap px-3 py-2.5 text-right text-xs tabular-nums";

/**
 * Tableau par compagnie : montant, part, ancienneté, ventilations activité et ancienneté, ligne de total.
 * Le nom de la compagnie et chaque montant d'activité sont des liens vers le panneau de détail (`?detail=`).
 */
export function ReceivablesTable({ summary, query, selected }: Readonly<{ summary: ReceivablesSummary; query: ReceivablesQuery; selected: DetailScope | null }>): React.JSX.Element {
  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <table className="w-full min-w-[1180px] text-sm">
        <thead className="border-b bg-muted/50">
          <tr>
            <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Compagnie</th>
            <th className={th}>Créance</th>
            <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Part</th>
            <th className={th}>Factures</th>
            <th className={th}>Plus ancienne</th>
            <th className={th}>Assistance</th>
            <th className={th}>BDG</th>
            <th className={th}>Autre</th>
            {AGING_BUCKETS.map((bucket) => (
              <th key={bucket.key} className={th}>
                {bucket.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {summary.companies.map((row) => (
            <tr key={row.company} className="hover:bg-muted/40">
              <td className="px-3 py-2.5">
                <Link
                  href={receivablesHref(query, { detail: scopeKey({ company: row.company, activity: null }), anc: undefined }, "detail")}
                  aria-current={selected?.company === row.company && selected.activity === null ? "true" : undefined}
                  aria-label={`${row.company} : ouvrir le détail des factures par succursale`}
                  className="flex items-center gap-3 font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <CompanyLogo company={row.company} />
                  <span>{row.company}</span>
                </Link>
              </td>
              <td className={`${td} text-sm font-semibold`}>{formatDA(row.amount)}</td>
              <td className="min-w-36 px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${row.company} : ${pct(row.share)} de la créance`}>
                    <div className="h-full rounded-full" style={{ width: `${Math.min(100, row.share)}%`, backgroundColor: companyColor(row.company) }} />
                  </div>
                  <span className="w-14 text-right text-xs tabular-nums">{pct(row.share)}</span>
                </div>
              </td>
              <td className={td}>{row.count}</td>
              <td className={td}>
                {row.oldestDays === null ? (
                  <span className="text-muted-foreground">–</span>
                ) : (
                  <>
                    <span className="font-medium">{row.oldestDays} j</span>
                    <span className="block text-muted-foreground">{formatDate(row.oldestDate)}</span>
                  </>
                )}
              </td>
              {ACTIVITY_KEYS.map((activity) => (
                <td key={activity} className={td}>
                  {row.byActivity[activity].count === 0 ? (
                    formatDA(0)
                  ) : (
                    <Link
                      href={receivablesHref(query, { detail: scopeKey({ company: row.company, activity }), anc: undefined }, "detail")}
                      aria-current={selected?.company === row.company && selected.activity === activity ? "true" : undefined}
                      aria-label={`${row.company}, ${ACTIVITY_LABELS[activity]} : ouvrir le détail`}
                      className="underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {formatDA(row.byActivity[activity].amount)}
                    </Link>
                  )}
                </td>
              ))}
              {AGING_BUCKETS.map((bucket) => (
                <td key={bucket.key} className={td}>
                  {row.aging[bucket.key].count === 0 ? (
                    <span className="text-muted-foreground">–</span>
                  ) : (
                    <>
                      {formatDA(row.aging[bucket.key].amount)}
                      <span className="block text-muted-foreground">{row.aging[bucket.key].count} fact.</span>
                    </>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t-2 bg-muted/50 font-semibold">
          <tr>
            <td className="px-3 py-2.5">
              <Link href={invoicesHref(null, [], query)} className="hover:underline">
                Total
              </Link>
            </td>
            <td className={`${td} text-sm`}>{formatDA(summary.total)}</td>
            <td className="px-3 py-2.5 text-xs tabular-nums">{summary.companies.length > 0 ? pct(100) : "–"}</td>
            <td className={td}>{summary.count}</td>
            <td className={td} />
            <td className={td}>{formatDA(summary.byActivity.ASSISTANCE.amount)}</td>
            <td className={td}>{formatDA(summary.byActivity.BDG.amount)}</td>
            <td className={td}>{formatDA(summary.byActivity.AUTRE.amount)}</td>
            {AGING_BUCKETS.map((bucket) => (
              <td key={bucket.key} className={td}>
                {formatDA(summary.aging[bucket.key].amount)}
                <span className="block font-normal text-muted-foreground">{summary.aging[bucket.key].count} fact.</span>
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
