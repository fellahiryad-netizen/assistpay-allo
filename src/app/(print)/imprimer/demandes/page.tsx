import type { Metadata } from "next";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { PrintToolbar } from "@/components/common/print-toolbar";
import { StateMessage } from "@/components/common/state-message";
import { DpSheet } from "@/features/payment-requests/components/dp-sheet";
import { getRequest } from "@/features/payment-requests/services/payment-request-service";
import type { PaymentRequestDTO } from "@/features/payment-requests/types";

export const metadata: Metadata = { title: "Impression des demandes de paiement" };

const idsSchema = z.string().max(4000).transform((value) => value.split(",").map((id) => id.trim()).filter((id) => /^[A-Za-z0-9_-]{1,64}$/.test(id)).slice(0, 100));

/** Impression d'une ou plusieurs demandes de paiement (une page A4 par demande). */
export default async function PrintRequestsPage({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>): Promise<React.JSX.Element> {
  const user = await requireUser();
  const raw = await searchParams;
  const ids = idsSchema.parse(Array.isArray(raw.ids) ? raw.ids.join(",") : raw.ids ?? "");
  const requests: PaymentRequestDTO[] = [];
  for (const id of ids) {
    const result = await getRequest(user, id);
    if (result.success) requests.push(result.data.request);
  }
  if (requests.length === 0) return <StateMessage kind="empty" title="Aucune demande à imprimer" className="mx-auto max-w-xl" />;
  return (
    <>
      <PrintToolbar title={`${requests.length} demande(s) de paiement`} />
      <div className="flex flex-col gap-6 print:gap-0">
        {requests.map((request) => (
          <DpSheet key={request.id} data={request} />
        ))}
      </div>
    </>
  );
}
