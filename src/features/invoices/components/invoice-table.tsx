"use client";

import Link from "next/link";
import { Printer } from "lucide-react";
import { useState, useTransition } from "react";
import { markInvoicePaidAction } from "@/app/actions/invoice-actions";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SensBadge, StatusBadge } from "@/features/invoices/components/invoice-badges";
import { InvoiceBulkBar } from "@/features/invoices/components/invoice-bulk-bar";
import { MarkPaidDialog } from "@/features/invoices/components/mark-paid-dialog";
import { useOptimisticInvoices } from "@/features/invoices/hooks/use-optimistic-invoices";
import type { MarkPaidInput } from "@/features/invoices/schemas";
import type { InvoiceDTO, SensKey } from "@/features/invoices/types";
import { daysBetween } from "@/utils/dates";
import { formatDA, formatDate } from "@/utils/format";

/** Au-delà de ce délai (jours), une facture déposée et non réglée est signalée en retard. */
const LATE_AFTER_DAYS = 60;

const MODE_SHORT = { VIREMENT: "Virement", CHEQUE: "Chèque", VERSEMENT: "Versement", AUTRE: "Autre" } as const;

/** Première ligne d'une facture : nom de la succursale quand elle est connue, sinon le tiers. */
function headline(invoice: InvoiceDTO): string {
  return invoice.succursaleNom ? `Succursale ${invoice.succursaleNom}` : invoice.tiers || "—";
}

/** Deuxième ligne : tiers (si la première est la succursale), période et libellé. */
function subline(invoice: InvoiceDTO): string {
  const parts = [invoice.succursaleNom && invoice.tiers && invoice.tiers !== "ALLO Assistance" ? invoice.tiers : "", invoice.periode ? `Période ${invoice.periode}` : "", invoice.libelle].filter(Boolean);
  return parts.join(" – ");
}

/** Propriétés du tableau de factures. */
export interface InvoiceTableProps {
  items: InvoiceDTO[];
  canEdit: Record<SensKey, boolean>;
  today: string;
  showSens: boolean;
  /** id de la ligne → id de la facture émise à imprimer. */
  printable?: Record<string, string>;
  isAdmin?: boolean;
}

/**
 * Liste des factures (cartes sur mobile, tableau à partir de la tablette) avec règlement en un clic.
 * Le passage à « Réglé » est affiché immédiatement (useOptimistic) puis confirmé par le serveur.
 */
export function InvoiceTable({ items, canEdit, today, showSens, printable = {}, isAdmin = false }: Readonly<InvoiceTableProps>): React.JSX.Element {
  const [optimisticItems, applyPatch] = useOptimisticInvoices(items);
  const [, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const selectable = optimisticItems.filter((invoice) => canEdit[invoice.sens]);
  const chosen = selectable.filter((invoice) => selected.has(invoice.id));
  const allChecked = selectable.length > 0 && chosen.length === selectable.length;

  function toggle(id: string): void {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll(): void {
    setSelected(allChecked ? new Set() : new Set(selectable.map((invoice) => invoice.id)));
  }

  const check = (invoice: InvoiceDTO): React.JSX.Element | null =>
    canEdit[invoice.sens] ? (
      <input type="checkbox" className="size-4 cursor-pointer accent-primary" checked={selected.has(invoice.id)} onChange={() => toggle(invoice.id)} aria-label={`Sélectionner ${invoice.numero || invoice.tiers}`} />
    ) : null;

  function confirmPaid(input: MarkPaidInput): Promise<string | null> {
    return new Promise((resolve) => {
      startTransition(async () => {
        applyPatch({ id: input.id, status: "REGLE", dateOperation: input.date, mode: input.mode });
        const result = await markInvoicePaidAction(input);
        resolve(result.success ? null : result.error);
      });
    });
  }

  const action = (invoice: InvoiceDTO): React.JSX.Element | null => {
    const printId = printable[invoice.id];
    const pay = invoice.status === "EN_ATTENTE" && canEdit[invoice.sens] ? <MarkPaidDialog invoice={invoice} today={today} onConfirm={confirmPaid} compact /> : null;
    if (!printId && !pay) return null;
    return (
      <div className="flex items-center justify-end gap-2">
        {printId ? (
          <Link href={`/imprimer/factures?ids=${printId}`} target="_blank" className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium hover:bg-muted" title="Imprimer la facture">
            <Printer className="size-3.5" aria-hidden />
            Imprimer
          </Link>
        ) : null}
        {pay}
      </div>
    );
  };

  return (
    <>
      {selectable.length > 0 ? (
        <label className="mb-2 flex w-fit cursor-pointer items-center gap-2 text-sm md:hidden">
          <input type="checkbox" className="size-4 accent-primary" checked={allChecked} onChange={toggleAll} />
          Tout sélectionner
        </label>
      ) : null}
      <InvoiceBulkBar
        ids={chosen.map((invoice) => invoice.id)}
        payableIds={chosen.filter((invoice) => invoice.status === "EN_ATTENTE").map((invoice) => invoice.id)}
        total={chosen.reduce((sum, invoice) => sum + invoice.montant, 0)}
        today={today}
        isAdmin={isAdmin}
        onClear={() => setSelected(new Set())}
      />
      <ul className="flex flex-col gap-2 md:hidden">
        {optimisticItems.map((invoice) => (
          <li key={invoice.id} className="rounded-lg border bg-card p-3">
            <div className="flex items-start justify-between gap-2">
              {check(invoice)}
              <Link href={`/factures/${invoice.id}`} className="min-w-0 flex-1 font-medium hover:underline">
                <span className="block truncate">{headline(invoice)}</span>
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
              <TableHead className="w-8">
                {selectable.length > 0 ? <input type="checkbox" className="size-4 cursor-pointer accent-primary" checked={allChecked} onChange={toggleAll} aria-label="Tout sélectionner" /> : null}
              </TableHead>
              <TableHead>Dépôt facture</TableHead>
              {showSens ? <TableHead>Sens</TableHead> : null}
              <TableHead>Tiers et libellé</TableHead>
              <TableHead>N° facture</TableHead>
              <TableHead>Partenaire / catégorie</TableHead>
              <TableHead className="text-right">Montant (DA)</TableHead>
              <TableHead>Date de règlement</TableHead>
              <TableHead>État</TableHead>
              <TableHead>Par</TableHead>
              <TableHead className="text-right">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {optimisticItems.map((invoice) => {
              const waiting = invoice.status === "EN_ATTENTE" && invoice.dateFacture ? daysBetween(invoice.dateFacture, today) : null;
              return (
                <TableRow key={invoice.id} data-state={selected.has(invoice.id) ? "selected" : undefined}>
                  <TableCell>{check(invoice)}</TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums">
                    {formatDate(invoice.dateFacture)}
                    {waiting !== null && waiting >= 0 ? (
                      <span className={`block text-xs ${waiting > LATE_AFTER_DAYS ? "font-semibold text-destructive" : "text-muted-foreground"}`}>depuis {waiting} j</span>
                    ) : null}
                  </TableCell>
                  {showSens ? (
                    <TableCell>
                      <SensBadge sens={invoice.sens} />
                    </TableCell>
                  ) : null}
                  <TableCell className="max-w-80">
                    <Link href={`/factures/${invoice.id}`} className="block truncate font-semibold hover:underline">
                      {headline(invoice)}
                    </Link>
                    <span className="block truncate text-xs text-muted-foreground">{subline(invoice)}</span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{invoice.numero || "—"}</TableCell>
                  <TableCell className="max-w-44 text-sm">
                    <span className="block truncate">{invoice.categorie || "Sans catégorie"}</span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right font-semibold tabular-nums">{formatDA(invoice.montant)}</TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums">
                    {invoice.status === "REGLE" ? formatDate(invoice.dateOperation) : "—"}
                    {invoice.status === "REGLE" && (invoice.mode || invoice.cheque) ? (
                      <span className="block text-xs text-muted-foreground">{[invoice.mode ? MODE_SHORT[invoice.mode] : "", invoice.cheque].filter(Boolean).join(" ")}</span>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={invoice.status} />
                    {invoice.partiel ? <span className="mt-1 block text-xs font-semibold text-primary">partiel</span> : null}
                  </TableCell>
                  <TableCell className="max-w-28 truncate text-xs text-muted-foreground">{invoice.par || "—"}</TableCell>
                  <TableCell className="text-right">{action(invoice)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
