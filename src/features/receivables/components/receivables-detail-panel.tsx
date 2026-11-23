import Link from "next/link";
import { Download, ExternalLink, Mail, Printer } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { CompanyLogo } from "@/features/receivables/components/company-logo";
import { DETAIL_AGE_FILTERS, agingLabelOf, scopeKey, scopeLabel } from "@/features/receivables/lib/detail";
import { invoicesHref, receivablesHref } from "@/features/receivables/lib/links";
import type { ReceivablesQuery } from "@/features/receivables/schemas";
import type { ReceivableDetail } from "@/features/receivables/types";
import { cn } from "@/utils/cn";
import { formatDA, formatDate } from "@/utils/format";

/** Propriétés du panneau de détail. */
export interface ReceivableDetailPanelProps {
  detail: ReceivableDetail;
  query: ReceivablesQuery;
  canExport: boolean;
  canRelance: boolean;
}

const pct = (value: number): string => `${value.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;

function queryString(query: ReceivablesQuery): string {
  const params = new URLSearchParams();
  if (query.annee) params.set("annee", String(query.annee));
  if (query.activite) params.set("activite", query.activite);
  if (query.detail) params.set("detail", query.detail);
  if (query.anc) params.set("anc", String(query.anc));
  return params.toString();
}

/**
 * Panneau de détail en bas de page : factures en attente du périmètre cliqué, par succursale (sous-totaux, parts),
 * avec filtre d'ancienneté, export Excel, version imprimable et liens vers la fiche partenaire pour préparer la relance.
 */
export function ReceivableDetailPanel({ detail, query, canExport, canRelance }: Readonly<ReceivableDetailPanelProps>): React.JSX.Element {
  const qs = queryString(query);
  const filterLink = (anc: 30 | 60 | 90 | undefined): string => receivablesHref(query, { anc }, "detail");
  return (
    <section id="detail" aria-labelledby="detail-title" className="scroll-mt-4 rounded-lg border bg-card">
      <header className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-3">
          <CompanyLogo company={detail.scope.company} />
          <div>
            <h2 id="detail-title" className="text-base font-semibold">
              Détail : {scopeLabel(detail.scope)}
            </h2>
            <p className="text-sm text-muted-foreground">
              {detail.count} facture(s) · <span className="font-semibold tabular-nums text-foreground">{formatDA(detail.total)}</span>
              {detail.minAge ? ` (sur ${formatDA(detail.scopeTotal)} au total, ${detail.scopeCount} facture(s))` : ""}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          {canExport ? (
            <a href={`/api/creances/detail?${qs}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
              <Download />
              Exporter ce détail en Excel
            </a>
          ) : null}
          <Link href={`/imprimer/creances-detail?${qs}`} target="_blank" className={buttonVariants({ variant: "outline", size: "sm" })}>
            <Printer />
            Imprimer le détail
          </Link>
          <Link href={invoicesHref(detail.scope.company, [], query)} className={buttonVariants({ variant: "ghost", size: "sm" })}>
            <ExternalLink />
            Voir dans les factures
          </Link>
          <Link href={receivablesHref(query, { detail: undefined, anc: undefined })} className={buttonVariants({ variant: "ghost", size: "sm" })}>
            Fermer
          </Link>
        </div>
      </header>
      <nav aria-label="Filtre d'ancienneté" className="flex flex-wrap items-center gap-2 border-b px-4 py-3 text-sm print:hidden">
        <span className="text-muted-foreground">Relance :</span>
        <Link href={filterLink(undefined)} aria-current={!detail.minAge ? "true" : undefined} className={cn("rounded-full border px-3 py-1 text-xs", !detail.minAge ? "bg-primary text-primary-foreground" : "hover:bg-muted")}>
          Toutes
        </Link>
        {DETAIL_AGE_FILTERS.map((days) => (
          <Link key={days} href={filterLink(days)} aria-current={detail.minAge === days ? "true" : undefined} className={cn("rounded-full border px-3 py-1 text-xs", detail.minAge === days ? "bg-primary text-primary-foreground" : "hover:bg-muted")}>
            Plus de {days} j
          </Link>
        ))}
        <span className="text-xs text-muted-foreground">(les factures sans date sont incluses, comme dans la lettre de relance)</span>
      </nav>
      {detail.branches.length === 0 ? (
        <p className="p-6 text-center text-sm text-muted-foreground">Aucune facture pour ce périmètre et ce filtre.</p>
      ) : (
        <div className="flex flex-col divide-y">
          {detail.branches.map((branch) => (
            <details key={branch.label} open className="group">
              <summary className="flex cursor-pointer flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <span className="min-w-[10rem] flex-1 font-medium">{branch.label}</span>
                <span className="text-xs text-muted-foreground">
                  {branch.count} facture(s) · {pct(branch.share)}
                  {branch.oldestDays !== null ? ` · la plus ancienne : ${branch.oldestDays} j` : ""}
                  {branch.lastReminder ? ` · dernière relance : ${formatDate(branch.lastReminder)}` : ""}
                </span>
                <span className="font-semibold tabular-nums">{formatDA(branch.amount)}</span>
              </summary>
              <div className="overflow-x-auto px-4 pb-3">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="py-1.5 pr-3 font-medium">N° facture</th>
                      <th className="py-1.5 pr-3 font-medium">Libellé / période</th>
                      <th className="py-1.5 pr-3 font-medium">Date</th>
                      <th className="py-1.5 pr-3 text-right font-medium">Ancienneté</th>
                      <th className="py-1.5 pr-3 font-medium">Dernière relance</th>
                      <th className="py-1.5 text-right font-medium">Montant</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {branch.invoices.map((invoice) => (
                      <tr key={invoice.id}>
                        <td className="whitespace-nowrap py-1.5 pr-3 font-medium">
                          <Link href={`/factures/${invoice.id}`} className="hover:underline">
                            {invoice.numero || "sans n°"}
                          </Link>
                        </td>
                        <td className="max-w-md py-1.5 pr-3">
                          <span className="line-clamp-2">{invoice.libelle}</span>
                          {invoice.periode ? <span className="block text-xs text-muted-foreground">{invoice.periode}</span> : null}
                        </td>
                        <td className="whitespace-nowrap py-1.5 pr-3 tabular-nums">{invoice.date ? formatDate(invoice.date) : <span className="text-muted-foreground">sans date</span>}</td>
                        <td className="whitespace-nowrap py-1.5 pr-3 text-right tabular-nums">
                          {invoice.ageDays === null ? "–" : `${invoice.ageDays} j`}
                          <span className="block text-xs text-muted-foreground">{agingLabelOf(invoice.aging)}</span>
                        </td>
                        <td className="whitespace-nowrap py-1.5 pr-3 tabular-nums">{invoice.lastReminder ? formatDate(invoice.lastReminder) : <span className="text-muted-foreground">–</span>}</td>
                        <td className="whitespace-nowrap py-1.5 text-right font-medium tabular-nums">{formatDA(invoice.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 font-semibold">
                      <td colSpan={5} className="py-1.5 pr-3 text-right">
                        Sous-total {branch.label}
                      </td>
                      <td className="whitespace-nowrap py-1.5 text-right tabular-nums">{formatDA(branch.amount)}</td>
                    </tr>
                  </tfoot>
                </table>
                {canRelance && branch.branchKey ? (
                  <div className="mt-2 flex flex-wrap gap-3 text-xs print:hidden">
                    {branch.partners.map((partner) => (
                      <Link
                        key={partner}
                        href={`/partenaires/${encodeURIComponent(partner)}?${new URLSearchParams({ succ: branch.branchKey, seuil: String(detail.minAge ?? 60) }).toString()}`}
                        className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                      >
                        <Mail className="size-3.5" aria-hidden />
                        Préparer la relance{branch.partners.length > 1 ? ` (${partner})` : ""}
                      </Link>
                    ))}
                  </div>
                ) : null}
              </div>
            </details>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-2 bg-muted/50 px-4 py-3 text-sm font-semibold">
            <span>Total du détail ({scopeKey(detail.scope)})</span>
            <span className="tabular-nums">{formatDA(detail.total)}</span>
          </div>
        </div>
      )}
    </section>
  );
}
