import Link from "next/link";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InvoiceStatusActions } from "@/features/invoices/components/invoice-status-actions";
import { SensBadge, StatusBadge } from "@/features/invoices/components/invoice-badges";
import { MODE_LABELS, type InvoiceDTO } from "@/features/invoices/types";
import { formatDA, formatDate, formatDateTime } from "@/utils/format";

/** Propriétés de la fiche facture. */
export interface InvoiceDetailProps {
  invoice: InvoiceDTO;
  canEdit: boolean;
  today: string;
}

/** Fiche détaillée d'une facture avec les actions autorisées. */
export function InvoiceDetail({ invoice, canEdit, today }: Readonly<InvoiceDetailProps>): React.JSX.Element {
  const rows: Array<[string, string]> = [
    ["Tiers", invoice.tiers || "—"],
    ["N° de facture", invoice.numero || "—"],
    ["Catégorie", invoice.categorie || "—"],
    ["Nature", invoice.nature || "—"],
    ["Libellé", invoice.libelle || "—"],
    ["Date de facture", formatDate(invoice.dateFacture) || "—"],
    ["Date de règlement / opération", formatDate(invoice.dateOperation) || "—"],
    ["Mode", invoice.mode ? MODE_LABELS[invoice.mode] : "—"],
    ["N° de chèque / référence", invoice.cheque || "—"],
    ["Banque", invoice.banque || "—"],
    ["Succursale", invoice.succursale || "—"],
    ["Période", invoice.periode || "—"],
    ["Année", invoice.annee ? String(invoice.annee) : "—"],
  ];
  if (invoice.debours !== null) rows.push(["Débours", formatDA(invoice.debours)]);
  if (invoice.frais !== null) rows.push(["Frais de gestion", formatDA(invoice.frais)]);
  if (invoice.montantGlobal !== null) rows.push(["Montant global du règlement", formatDA(invoice.montantGlobal)]);
  if (invoice.origine) rows.push(["Origine", invoice.origine]);

  return (
    <Card>
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <SensBadge sens={invoice.sens} />
            <StatusBadge status={invoice.status} />
            {invoice.archived ? <span className="text-xs text-muted-foreground">reprise des archives</span> : null}
          </div>
          <CardTitle className="text-2xl tabular-nums">{formatDA(invoice.montant)}</CardTitle>
          <p className="text-xs text-muted-foreground">Dernière modification : {formatDateTime(invoice.updatedAt)}</p>
        </div>
        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            <InvoiceStatusActions invoice={invoice} today={today} />
            <Button variant="outline" size="sm" asChild>
              <Link href={`/factures/${invoice.id}/modifier`}>
                <Pencil />
                Modifier
              </Link>
            </Button>
          </div>
        ) : null}
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="break-words text-sm">{value}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
