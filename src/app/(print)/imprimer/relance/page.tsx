import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { PrintToolbar } from "@/components/common/print-toolbar";
import { StateMessage } from "@/components/common/state-message";
import { ISSUER } from "@/features/billing/config";
import { partnerQuerySchema } from "@/features/partners/schemas";
import { overdueInvoices } from "@/features/partners/services/partner-service";
import { todayIso } from "@/utils/dates";
import { formatDA, formatDate } from "@/utils/format";

export const metadata: Metadata = { title: "Lettre de relance" };

/** Lettre de relance d'un partenaire pour ses factures en retard. */
export default async function PrintReminderPage({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>): Promise<React.JSX.Element> {
  const user = await requireUser();
  const raw = await searchParams;
  const one = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value) || undefined;
  const parsed = partnerQuerySchema.safeParse({ key: one(raw.key), succ: one(raw.succ) ?? "", seuil: one(raw.seuil) });
  if (!parsed.success) return <StateMessage kind="error" title="Paramètres invalides" className="mx-auto max-w-xl" />;
  const result = await overdueInvoices(user, parsed.data);
  if (!result.success || result.data.invoices.length === 0) return <StateMessage kind="empty" title="Aucune facture à relancer" className="mx-auto max-w-xl" />;
  const { invoices, total } = result.data;
  const cell = { border: "1px solid #999", padding: "4px 6px", fontSize: "10.5pt" } as const;
  return (
    <>
      <PrintToolbar title="Lettre de relance" />
      <div className="dp-sheet">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <img src="/logo-allo.png" alt="Allo Assistance" style={{ height: "16mm" }} />
          <div style={{ textAlign: "right" }}>
            <b>{ISSUER.nom}</b>
            <br />
            {ISSUER.ville}, le {formatDate(todayIso())}
          </div>
        </div>
        <p style={{ marginTop: "10mm" }}>
          <b>À l&apos;attention de :</b> {parsed.data.key}
          {parsed.data.succ ? ` – Succursale ${parsed.data.succ}` : ""}
          <br />
          Service Finances et Comptabilité
        </p>
        <p style={{ margin: "8mm 0 4mm" }}>
          <b>Objet : relance pour règlement de factures</b>
        </p>
        <p>Madame, Monsieur,</p>
        <p style={{ margin: "3mm 0" }}>
          Sauf erreur de notre part, les factures ci-dessous restent impayées à ce jour, au-delà du délai de règlement convenu. Nous vous serions reconnaissants de bien vouloir procéder à leur
          règlement dans les meilleurs délais, ou de nous faire part de toute observation.
        </p>
        <table style={{ width: "100%", borderCollapse: "collapse", margin: "4mm 0" }}>
          <thead>
            <tr>
              {["N° facture", "Objet", "Date", "Montant TTC", "Reste dû", "Retard"].map((label) => (
                <th key={label} style={{ ...cell, background: "#f1ebf6", textAlign: "left" }}>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {invoices.map((invoice) => (
              <tr key={invoice.id}>
                <td style={cell}>{invoice.numero || "—"}</td>
                <td style={cell}>{invoice.libelle}</td>
                <td style={cell}>{invoice.factureDate ? formatDate(invoice.factureDate) : "—"}</td>
                <td style={{ ...cell, textAlign: "right", whiteSpace: "nowrap" }}>{formatDA(invoice.montant)}</td>
                <td style={{ ...cell, textAlign: "right", whiteSpace: "nowrap" }}>{formatDA(invoice.remaining)}</td>
                <td style={{ ...cell, textAlign: "right" }}>{invoice.ageDays !== null ? `${invoice.ageDays} j` : "—"}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4} style={{ ...cell, textAlign: "right" }}>
                <b>Total restant dû</b>
              </td>
              <td style={{ ...cell, textAlign: "right", whiteSpace: "nowrap" }}>
                <b>{formatDA(total)}</b>
              </td>
              <td style={cell} />
            </tr>
          </tfoot>
        </table>
        <p>
          Règlement par chèque ou virement sur le compte AGB, agence Dely Brahim – RIB : {ISSUER.rib}.
        </p>
        <p style={{ marginTop: "3mm" }}>Nous vous prions d&apos;agréer, Madame, Monsieur, l&apos;expression de nos salutations distinguées.</p>
        <p style={{ marginTop: "12mm", textAlign: "right" }}>
          <b>{user.name}</b>
          <br />
          EURL Allo Assistance
        </p>
      </div>
    </>
  );
}
