"use client";

import { useOptimistic } from "react";
import type { InvoiceDTO, InvoiceStatusKey, PaymentModeKey } from "@/features/invoices/types";

/** Changement appliqué immédiatement à l'écran, avant la confirmation du serveur. */
export interface OptimisticInvoicePatch {
  id: string;
  status: InvoiceStatusKey;
  dateOperation?: string;
  mode?: PaymentModeKey;
}

/**
 * Liste de factures avec mises à jour optimistes : l'état change à l'écran dès le clic,
 * puis la liste revalidée par le serveur remplace la version optimiste.
 */
export function useOptimisticInvoices(items: InvoiceDTO[]): [InvoiceDTO[], (patch: OptimisticInvoicePatch) => void] {
  return useOptimistic<InvoiceDTO[], OptimisticInvoicePatch>(items, (current, patch) =>
    current.map((item) =>
      item.id === patch.id
        ? {
            ...item,
            status: patch.status,
            dateOperation: patch.dateOperation ?? item.dateOperation,
            mode: patch.mode ?? item.mode,
          }
        : item,
    ),
  );
}
