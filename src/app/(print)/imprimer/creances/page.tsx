import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { PrintToolbar } from "@/components/common/print-toolbar";
import { StateMessage } from "@/components/common/state-message";
import { ISSUER } from "@/features/billing/config";
import { AGING_BUCKETS } from "@/features/receivables/lib/aging";
import { receivablesQuerySchema } from "@/features/receivables/schemas";
import { getReceivables } from "@/features/receivables/services/receivables-service";
import { formatDate } from "@/utils/format";

export const metadata: Metadata = { title: "État des créances" };

const numberFormat = new Intl.NumberFormat("fr-DZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const amount = (value: number): string => numberFormat.format(value);
const percent = (value: number): string => `${value.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;

/** Noir sur blanc, tout en gras, sans fond coloré (impression en noir et blanc). */
const cell = { border: "1px solid #000", padding: "3px 4px", fontSize: "8.5pt", fontWeight: 700, color: "#000", background: "#fff" } as const;
const num = { ...cell, textAlign: "right", whiteSpace: "nowrap" } as const;

/** État imprimable des créances par compagnie (noir et blanc, A4 paysage). */
export default async function PrintReceivablesPage({ searchParams }: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>): Promise<React.JSX.Element> {
  const user = await requireUser();
  const raw = await searchParams;
  const one = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value) || undefined;
  const query = receivablesQuerySchema.parse({ annee: one(raw.annee), activite: one(raw.activite) });
  const result = await getReceivables(user, query);
  if (!result.success) return <StateMessage kind={result.code === "FORBIDDEN" ? "forbidden" : "error"} title="État indisponible" message={result.error} className="mx-auto max-w-xl" />;
  const { summary } = result.data;
  if (summary.count === 0) return <StateMessage kind="empty" title="Aucune créance en attente" className="mx-auto max-w-xl" />;
  const filters = [query.annee ? `année ${query.annee}` : "toutes les années", query.activite === "BDG" ? "activité BDG" : query.activite === "ASSISTANCE" ? "activité Assistance" : "toutes les activités"].join(" · ");
  return (
    <>
      <style>{"@media print { @page { size: A4 landscape; margin: 8mm; } }"}</style>
      <PrintToolbar title="État des créances par compagnie" />
      <div className="mx-auto bg-white p-4 print:p-0" style={{ maxWidth: "277mm", color: "#000", fontWeight: 700 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4mm" }}>
          <img src="/logo-allo.png" alt="Allo Assistance" style={{ height: "14mm" }} />
          <div style={{ textAlign: "right", fontSize: "10pt" }}>
            {ISSUER.nom}
            <br />
            Situation au {formatDate(summary.asOf)}
          </div>
        </div>
        <h1 style={{ fontSize: "15pt", fontWeight: 800, margin: "0 0 1mm" }}>Créances par compagnie : factures partenaires en attente</h1>
        <p style={{ fontSize: "9.5pt", margin: "0 0 4mm" }}>
          {filters} · {summary.count} facture(s) · total {amount(summary.total)} DA
          {summary.weightedAgeDays !== null ? ` · ancienneté moyenne pondérée ${summary.weightedAgeDays.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} jours` : ""}
        </p>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["Compagnie", "Créance (DA)", "Part", "Fact.", "Plus ancienne", "Assistance", "BDG", "Autre", ...AGING_BUCKETS.map((bucket) => bucket.label)].map((label) => (
                <th key={label} style={{ ...cell, textAlign: label === "Compagnie" ? "left" : "right", borderBottom: "2px solid #000" }}>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {summary.companies.map((row) => (
              <tr key={row.company}>
                <td style={cell}>{row.company}</td>
                <td style={num}>{amount(row.amount)}</td>
                <td style={num}>{percent(row.share)}</td>
                <td style={num}>{row.count}</td>
                <td style={num}>{row.oldestDays === null ? "–" : `${row.oldestDays} j (${formatDate(row.oldestDate)})`}</td>
                <td style={num}>{amount(row.byActivity.ASSISTANCE.amount)}</td>
                <td style={num}>{amount(row.byActivity.BDG.amount)}</td>
                <td style={num}>{amount(row.byActivity.AUTRE.amount)}</td>
                {AGING_BUCKETS.map((bucket) => (
                  <td key={bucket.key} style={num}>
                    {row.aging[bucket.key].count === 0 ? "–" : `${amount(row.aging[bucket.key].amount)} (${row.aging[bucket.key].count})`}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td style={{ ...cell, borderTop: "2px solid #000" }}>TOTAL</td>
              <td style={{ ...num, borderTop: "2px solid #000" }}>{amount(summary.total)}</td>
              <td style={{ ...num, borderTop: "2px solid #000" }}>{percent(100)}</td>
              <td style={{ ...num, borderTop: "2px solid #000" }}>{summary.count}</td>
              <td style={{ ...num, borderTop: "2px solid #000" }} />
              <td style={{ ...num, borderTop: "2px solid #000" }}>{amount(summary.byActivity.ASSISTANCE.amount)}</td>
              <td style={{ ...num, borderTop: "2px solid #000" }}>{amount(summary.byActivity.BDG.amount)}</td>
              <td style={{ ...num, borderTop: "2px solid #000" }}>{amount(summary.byActivity.AUTRE.amount)}</td>
              {AGING_BUCKETS.map((bucket) => (
                <td key={bucket.key} style={{ ...num, borderTop: "2px solid #000" }}>
                  {amount(summary.aging[bucket.key].amount)} ({summary.aging[bucket.key].count})
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
        <div style={{ marginTop: "5mm", fontSize: "9.5pt" }}>
          <p style={{ margin: "0 0 1mm" }}>Points d&apos;attention</p>
          <p style={{ margin: 0 }}>
            Plus de 90 jours : {summary.attention.over90.length === 0 ? "aucune facture" : summary.attention.over90.map((item) => `${item.company} ${item.count} fact. (${amount(item.amount)} DA)`).join(" ; ")}.
          </p>
          <p style={{ margin: "1mm 0 0" }}>
            Sans date : {summary.attention.undated.length === 0 ? "aucune facture" : summary.attention.undated.map((item) => `${item.company} ${item.count} fact. (${amount(item.amount)} DA)`).join(" ; ")}.
          </p>
        </div>
      </div>
    </>
  );
}
