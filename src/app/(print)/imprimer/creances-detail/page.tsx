import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { PrintToolbar } from "@/components/common/print-toolbar";
import { StateMessage } from "@/components/common/state-message";
import { ISSUER } from "@/features/billing/config";
import { agingLabelOf, scopeLabel } from "@/features/receivables/lib/detail";
import { receivablesQuerySchema } from "@/features/receivables/schemas";
import { getReceivableDetail } from "@/features/receivables/services/receivables-service";
import { formatDate } from "@/utils/format";

export const metadata: Metadata = { title: "Détail des créances" };

const numberFormat = new Intl.NumberFormat("fr-DZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const amount = (value: number): string => numberFormat.format(value);
const percent = (value: number): string => `${value.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;

/** Noir sur blanc, tout en gras, sans fond coloré ni logo (impression en noir et blanc). */
const cell = { border: "1px solid #000", padding: "3px 5px", fontSize: "9.5pt", fontWeight: 700, color: "#000", background: "#fff" } as const;
const num = { ...cell, textAlign: "right", whiteSpace: "nowrap" } as const;

/** Détail imprimable des factures en attente d'une compagnie : une section par succursale, prête à joindre à un mail de relance. */
export default async function PrintReceivableDetailPage({ searchParams }: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>): Promise<React.JSX.Element> {
  const user = await requireUser();
  const raw = await searchParams;
  const one = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value) || undefined;
  const query = receivablesQuerySchema.parse({ annee: one(raw.annee), activite: one(raw.activite), detail: one(raw.detail), anc: one(raw.anc) });
  const result = await getReceivableDetail(user, query);
  if (!result.success) return <StateMessage kind={result.code === "FORBIDDEN" ? "forbidden" : "error"} title="Détail indisponible" message={result.error} className="mx-auto max-w-xl" />;
  const { detail, asOf } = result.data;
  if (detail.branches.length === 0) return <StateMessage kind="empty" title="Aucune facture pour ce périmètre" className="mx-auto max-w-xl" />;
  const filters = [query.annee ? `année ${query.annee}` : "toutes les années", detail.minAge ? `plus de ${detail.minAge} jours ou sans date` : "toutes les anciennetés"].join(" · ");
  return (
    <>
      <PrintToolbar title={`Détail des créances ${scopeLabel(detail.scope)}`} />
      <div className="mx-auto bg-white p-4 print:p-0" style={{ maxWidth: "190mm", color: "#000", fontWeight: 700 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4mm" }}>
          <img src="/logo-allo.png" alt="Allo Assistance" style={{ height: "14mm" }} />
          <div style={{ textAlign: "right", fontSize: "10pt" }}>
            {ISSUER.nom}
            <br />
            Situation au {formatDate(asOf)}
          </div>
        </div>
        <h1 style={{ fontSize: "15pt", fontWeight: 800, margin: "0 0 1mm" }}>Factures en attente : {scopeLabel(detail.scope)}</h1>
        <p style={{ fontSize: "10pt", margin: "0 0 4mm" }}>
          {filters} · {detail.count} facture(s) · total {amount(detail.total)} DA
        </p>
        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "6mm" }}>
          <thead>
            <tr>
              {["Succursale", "Factures", "Montant (DA)", "Part", "Plus ancienne"].map((label) => (
                <th key={label} style={{ ...cell, textAlign: label === "Succursale" ? "left" : "right", borderBottom: "2px solid #000" }}>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {detail.branches.map((branch) => (
              <tr key={branch.label}>
                <td style={cell}>{branch.label}</td>
                <td style={num}>{branch.count}</td>
                <td style={num}>{amount(branch.amount)}</td>
                <td style={num}>{percent(branch.share)}</td>
                <td style={num}>{branch.oldestDays === null ? "–" : `${branch.oldestDays} j`}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td style={{ ...cell, borderTop: "2px solid #000" }}>TOTAL</td>
              <td style={{ ...num, borderTop: "2px solid #000" }}>{detail.count}</td>
              <td style={{ ...num, borderTop: "2px solid #000" }}>{amount(detail.total)}</td>
              <td style={{ ...num, borderTop: "2px solid #000" }}>{percent(100)}</td>
              <td style={{ ...num, borderTop: "2px solid #000" }} />
            </tr>
          </tfoot>
        </table>
        {detail.branches.map((branch) => (
          <section key={branch.label} style={{ breakInside: "avoid-page", pageBreakBefore: "always", paddingTop: "2mm" }}>
            <h2 style={{ fontSize: "12pt", fontWeight: 800, margin: "0 0 2mm" }}>
              Succursale {branch.label} : {branch.count} facture(s), {amount(branch.amount)} DA
            </h2>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["N° facture", "Libellé / période", "Date", "Ancienneté", "Montant (DA)"].map((label) => (
                    <th key={label} style={{ ...cell, textAlign: label === "Montant (DA)" || label === "Ancienneté" ? "right" : "left", borderBottom: "2px solid #000" }}>
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {branch.invoices.map((invoice) => (
                  <tr key={invoice.id}>
                    <td style={cell}>{invoice.numero || "sans n°"}</td>
                    <td style={cell}>
                      {invoice.libelle}
                      {invoice.periode ? ` (${invoice.periode})` : ""}
                    </td>
                    <td style={{ ...cell, whiteSpace: "nowrap" }}>{invoice.date ? formatDate(invoice.date) : "sans date"}</td>
                    <td style={num}>{invoice.ageDays === null ? "–" : `${invoice.ageDays} j (${agingLabelOf(invoice.aging)})`}</td>
                    <td style={num}>{amount(invoice.amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4} style={{ ...cell, textAlign: "right", borderTop: "2px solid #000" }}>
                    Sous-total {branch.label}
                  </td>
                  <td style={{ ...num, borderTop: "2px solid #000" }}>{amount(branch.amount)}</td>
                </tr>
              </tfoot>
            </table>
          </section>
        ))}
      </div>
    </>
  );
}
