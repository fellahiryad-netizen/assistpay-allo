"use client";

import { useOptimistic, useState, useTransition } from "react";
import { Ban, Trash2, Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { requestDeletionAction } from "@/app/actions/deletion-actions";
import { markInvoicePaidAction, setInvoiceStatusAction } from "@/app/actions/invoice-actions";
import { Button } from "@/components/ui/button";
import { MarkPaidDialog } from "@/features/invoices/components/mark-paid-dialog";
import type { MarkPaidInput } from "@/features/invoices/schemas";
import { STATUS_LABELS, type InvoiceDTO, type InvoiceStatusKey } from "@/features/invoices/types";

/** Propriétés des actions d'état. */
export interface InvoiceStatusActionsProps {
  invoice: InvoiceDTO;
  today: string;
  /** « direct » : administrateur ; « request » : demande à valider ; « none » : bouton absent. */
  deleteMode?: "direct" | "request" | "none";
}

/** Actions de la fiche : régler, remettre en attente, annuler (affichage optimiste de l'état). */
export function InvoiceStatusActions({ invoice, today, deleteMode = "none" }: Readonly<InvoiceStatusActionsProps>): React.JSX.Element {
  const [status, setOptimisticStatus] = useOptimistic<InvoiceStatusKey, InvoiceStatusKey>(invoice.status, (_current, next) => next);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const [notice, setNotice] = useState<string | null>(null);

  function change(next: "EN_ATTENTE" | "ANNULE"): void {
    setError(null);
    startTransition(async () => {
      setOptimisticStatus(next);
      const result = await setInvoiceStatusAction({ id: invoice.id, status: next });
      if (!result.success) setError(result.error);
    });
  }

  function remove(): void {
    const motif = window.prompt(
      deleteMode === "direct"
        ? "Supprimer cette facture ? Cette action est définitive.\n\nMotif :"
        : "La suppression sera soumise à la validation d'un administrateur.\n\nMotif de la demande :",
    );
    if (motif === null) return;
    setError(null);
    startTransition(async () => {
      const result = await requestDeletionAction({ kind: "facture", id: invoice.id, motif });
      if (!result.success) setError(result.error);
      else if (result.data.done) router.push(`/factures?sens=${invoice.sens}`);
      else setNotice("Demande envoyée : un administrateur doit la valider.");
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
      {status !== "REGLE" && deleteMode !== "none" ? (
        <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={remove} className="text-destructive">
          <Trash2 />
          {deleteMode === "direct" ? "Supprimer" : "Demander la suppression"}
        </Button>
      ) : null}
      {notice ? <p className="w-full text-sm font-medium text-success">{notice}</p> : null}
      {error ? (
        <p role="alert" className="w-full text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
