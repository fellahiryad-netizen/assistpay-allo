"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FilePlus2 } from "lucide-react";
import { createRequestAction } from "@/app/actions/payment-request-actions";
import { Button } from "@/components/ui/button";
import { InvoicePickerDialog } from "@/features/payment-requests/components/invoice-picker-dialog";

/** Création d'une demande de paiement à partir de factures fournisseurs en attente. */
export function NewRequestButton(): React.JSX.Element {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        <FilePlus2 />
        Nouvelle demande
      </Button>
      <InvoicePickerDialog
        open={open}
        onOpenChange={setOpen}
        title="Nouvelle demande de paiement"
        description="Choisissez les factures du prestataire à payer : le montant, le bénéficiaire et les pièces jointes sont remplis automatiquement."
        confirmLabel="Créer la demande"
        onConfirm={async (invoiceIds) => {
          const result = await createRequestAction({ invoiceIds });
          if (!result.success) return result.error;
          setOpen(false);
          router.push(`/demandes/${result.data.id}`);
          return null;
        }}
      />
    </>
  );
}
