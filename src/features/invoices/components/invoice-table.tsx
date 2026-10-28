"use client";

import Link from "next/link";
import { useTransition } from "react";
import { markInvoicePaidAction } from "@/app/actions/invoice-actions";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SensBadge, StatusBadge } from "@/features/invoices/components/invoice-badges";
import { MarkPaidDialog } from "@/features/invoices/components/mark-paid-dialog";
import { useOptimisticInvoices } from "@/features/invoices/hooks/use-optimistic-invoices";
import type { MarkPaidInput } from "@/features/invoices/schemas";
import type { InvoiceDTO, SensKey } from "@/features/invoices/types";
import { formatDA, formatDate } from "@/utils/format";

/** Propriétés du tableau de factures. */
export interface InvoiceTableProps {
  items: InvoiceDTO[];
  canEdit: Record<SensKey, boolean>;
  today: string;
  showSens: boolean;
}

/**
 * Liste des factures (cartes sur mobile, tableau à partir de la tablette) avec règlement en un clic.
 * Le passage à « Réglé » est affiché immédiatement (useOptimistic) puis confirmé par le serveur.
 */
export function InvoiceTable({ items, canEdit, today, showSens }: Readonly<InvoiceTableProps>): React.JSX.Element {
  const [optimisticItems, applyPatch] = useOptimisticInvoices(items);
  const [, startTransition] = useTransition();

  function confirmPaid(input: MarkPaidInput): Promise<string | null> {
    return new Promise((resolve) => {
      startTransition(async () => {
        applyPatch({ id: input.id, status: "REGLE", dateOperation: input.date, mode: input.mode });
        const result = await markInvoicePaidAction(input);
        resolve(result.success ? null : result.error);
      });
    });
  }

  const action = (invoice: InvoiceDTO): React.JSX.Element | null =>
    invoice.status === "EN_ATTENTE" && canEdit[invoice.sens] ? (
      <MarkPaidDialog invoice={invoice} today={today} onConfirm={confirmPaid} compact />
    ) : null;

  return (
    <>
      <ul className="flex flex-col gap-2 md:hidden">
        {optimisticItems.map((invoice) => (
          <li key={invoice.id} className="rounded-lg border bg-card p-3">
            <div className="flex items-start justify-between gap-2">
              <Link href={`/factures/${invoice.id}`} className="min-w-0 font-medium hover:underline">
                <span className="block truncate">{invoice.tiers || "—"}</span>
                <span className="block truncate text-xs font-normal text-muted-foreground">
                  {invoice.numero || "sans numéro"} · {invoice.categorie || "sans catégorie"}
                </span>
              </Link>
              <StatusBadge status={invoice.status} />
            </div>
            <div className="mt-2 flex items-end justify-between gap-2">
              <div className="text-xs text-muted-foreground">
                {showSens ? <SensBadge sens={invoice.sens} /> : null} {formatDate(invoice.dateOperation ?? invoice.dateFacture)}
              </div>
              <p className="font-semibold tabular-nums">{formatDA(invoice.montant)}</p>
            </div>
            {action(invoice) ? <div className="mt-2 flex justify-end">{action(invoice)}</div> : null}
          </li>
        ))}
      </ul>

      <div className="hidden rounded-lg border bg-card md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              {showSens ? <TableHead>Sens</TableHead> : null}
              <TableHead>Tiers</TableHead>
              <TableHead>N° facture</TableHead>
              <TableHead className="hidden 2xl:table-cell">Catégorie / libellé</TableHead>
              <TableHead className="text-right">Montant</TableHead>
              <TableHead>État</TableHead>
              <TableHead className="text-right">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {optimisticItems.map((invoice) => (
              <TableRow key={invoice.id}>
                <TableCell className="whitespace-nowrap tabular-nums">
                  {formatDate(invoice.dateOperation ?? invoice.dateFacture)}
                  {invoice.dateFacture && invoice.dateOperation && invoice.dateFacture !== invoice.dateOperation ? (
                    <span className="block text-xs text-muted-foreground">fact. {formatDate(invoice.dateFacture)}</span>
                  ) : null}
                </TableCell>
                {showSens ? (
                  <TableCell>
                    <SensBadge sens={invoice.sens} />
                  </TableCell>
                ) : null}
                <TableCell className="max-w-56">
                  <Link href={`/factures/${invoice.id}`} className="block truncate font-medium hover:underline">
                    {invoice.tiers || "—"}
                  </Link>
                  <span className="block truncate text-xs text-muted-foreground 2xl:hidden">{invoice.categorie}</span>
                </TableCell>
                <TableCell className="whitespace-nowrap">{invoice.numero || "—"}</TableCell>
                <TableCell className="hidden max-w-72 2xl:table-cell">
                  <span className="block truncate">{invoice.categorie || "—"}</span>
                  <span className="block truncate text-xs text-muted-foreground">{invoice.libelle}</span>
                </TableCell>
                <TableCell className="whitespace-nowrap text-right font-medium tabular-nums">{formatDA(invoice.montant)}</TableCell>
                <TableCell>
                  <StatusBadge status={invoice.status} />
                </TableCell>
                <TableCell className="text-right">{action(invoice)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
