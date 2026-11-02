"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Printer, Trash2 } from "lucide-react";
import { deleteRequestAction } from "@/app/actions/payment-request-actions";
import { Notice } from "@/components/common/notice";
import { Button } from "@/components/ui/button";

/** Demande de paiement liée à une facture. */
export interface InvoiceDpItem {
  id: string;
  ref: string;
}

/** Impression PDF et suppression des demandes de paiement liées à la facture d'un prestataire. */
export function InvoiceDpActions({ items, isAdmin }: Readonly<{ items: InvoiceDpItem[]; isAdmin: boolean }>): React.JSX.Element | null {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (items.length === 0) return null;

  function remove(item: InvoiceDpItem): void {
    if (!window.confirm(`Supprimer définitivement la demande de paiement ${item.ref} ? La facture reste en place.`)) return;
    startTransition(async () => {
      const result = await deleteRequestAction(item.id);
      if (result.success) router.refresh();
      else setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      {items.map((item) => (
        <div key={item.id} className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href={`/imprimer/demandes?ids=${item.id}`} target="_blank">
              <Printer />
              Imprimer la demande {item.ref} (PDF)
            </Link>
          </Button>
          {isAdmin ? (
            <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => remove(item)}>
              <Trash2 />
              Supprimer la demande
            </Button>
          ) : null}
        </div>
      ))}
      {error ? <Notice tone="error">{error}</Notice> : null}
    </div>
  );
}
