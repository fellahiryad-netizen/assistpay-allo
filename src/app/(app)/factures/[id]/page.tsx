import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Printer } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/common/page-header";
import { StateMessage } from "@/components/common/state-message";
import { buttonVariants } from "@/components/ui/button";
import { can } from "@/features/access/services/access-rules";
import { InvoiceDetail } from "@/features/invoices/components/invoice-detail";
import { invoiceIdSchema } from "@/features/invoices/schemas";
import { requestIdsForInvoice } from "@/features/payment-requests/services/payment-request-service";
import { getInvoice, printableIdFor } from "@/features/invoices/services/invoice-service";
import { todayIso } from "@/utils/dates";

export const metadata: Metadata = { title: "Facture" };

/** Fiche d'une facture. */
export default async function InvoicePage({ params }: Readonly<{ params: Promise<{ id: string }> }>): Promise<React.JSX.Element> {
  const user = await requireUser();
  const { id } = await params;
  const parsedId = invoiceIdSchema.safeParse(id);
  if (!parsedId.success) notFound();
  const result = await getInvoice(user, parsedId.data);
  if (!result.success) {
    if (result.code === "NOT_FOUND") notFound();
    return <StateMessage kind={result.code === "FORBIDDEN" ? "forbidden" : "error"} title="Facture inaccessible" message={result.error} />;
  }
  const { invoice, canEdit } = result.data;
  const printId = await printableIdFor(user, invoice);
  const requestIds = invoice.sens === "DEBIT" ? await requestIdsForInvoice(user, invoice.id) : [];
  return (
    <>
      <PageHeader
        title={invoice.numero ? `Facture ${invoice.numero}` : "Facture sans numéro"}
        description={invoice.tiers}
        actions={
          <>
            {printId ? (
              <Link href={`/imprimer/factures?ids=${printId}`} target="_blank" className={buttonVariants({ variant: "default" })}>
                <Printer />
                Imprimer la facture
              </Link>
            ) : null}
            <Link href={`/factures?sens=${invoice.sens}`} className={buttonVariants({ variant: "ghost" })}>
              <ArrowLeft />
              Retour à la liste
            </Link>
          </>
        }
      />
      <InvoiceDetail invoice={invoice} canEdit={canEdit} deleteMode={user.isAdmin ? "direct" : can(user, "A_SUPPR", "EDIT") ? "request" : "none"} today={todayIso()} requestIds={requestIds} isAdmin={user.isAdmin} />
    </>
  );
}
