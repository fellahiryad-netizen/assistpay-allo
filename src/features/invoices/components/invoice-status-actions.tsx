"use client";

import { useOptimistic, useState, useTransition } from "react";
import { Ban, Undo2 } from "lucide-react";
import { markInvoicePaidAction, setInvoiceStatusAction } from "@/app/actions/invoice-actions";
import { Button } from "@/components/ui/button";
import { MarkPaidDialog } from "@/features/invoices/components/mark-paid-dialog";
import type { MarkPaidInput } from "@/features/invoices/schemas";
import { STATUS_LABELS, type InvoiceDTO, type InvoiceStatusKey } from "@/features/invoices/types";

/** Propriétés des actions d'état. */
export interface InvoiceStatusActionsProps {
  invoice: InvoiceDTO;
  today: string;
}

/** Actions de la fiche : régler, remettre en attente, annuler (affichage optimiste de l'état). */
export function InvoiceStatusActions({ invoice, today }: Readonly<InvoiceStatusActionsProps>): React.JSX.Element {
  const [status, setOptimisticStatus] = useOptimistic<InvoiceStatusKey, InvoiceStatusKey>(invoice.status, (_current, next) => next);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function change(next: "EN_ATTENTE" | "ANNULE"): void {
    setError(null);
    startTransition(async () => {
      setOptimisticStatus(next);
      const result = await setInvoiceStatusAction({ id: invoice.id, status: next });
      if (!result.success) setError(result.error);
    });
  }

  function confirmPaid(input: MarkPaidInput): Promise<string | null> {
    return new Promise((resolve) => {
      startTransition(async () => {
        setOptimisticStatus("REGLE");
        const result = await markInvoicePaidAction(input);
        resolve(result.success ? null : result.error);
      });
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="sr-only" aria-live="polite">
        État : {STATUS_LABELS[status]}
      </span>
      {status === "EN_ATTENTE" ? <MarkPaidDialog invoice={invoice} today={today} onConfirm={confirmPaid} triggerLabel="Marquer réglé" /> : null}
      {status !== "EN_ATTENTE" ? (
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => change("EN_ATTENTE")}>
          <Undo2 />
          Remettre en attente
        </Button>
      ) : null}
      {status === "EN_ATTENTE" ? (
        <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => change("ANNULE")}>
          <Ban />
          Annuler la facture
        </Button>
      ) : null}
      {error ? (
        <p role="alert" className="w-full text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
