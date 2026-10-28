import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/common/page-header";
import { StateMessage } from "@/components/common/state-message";
import { buttonVariants } from "@/components/ui/button";
import { InvoiceDetail } from "@/features/invoices/components/invoice-detail";
import { invoiceIdSchema } from "@/features/invoices/schemas";
import { getInvoice } from "@/features/invoices/services/invoice-service";
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
  return (
    <>
      <PageHeader
        title={invoice.numero ? `Facture ${invoice.numero}` : "Facture sans numéro"}
        description={invoice.tiers}
        actions={
          <Link href={`/factures?sens=${invoice.sens}`} className={buttonVariants({ variant: "ghost" })}>
            <ArrowLeft />
            Retour à la liste
          </Link>
        }
      />
      <InvoiceDetail invoice={invoice} canEdit={canEdit} today={todayIso()} />
    </>
  );
}
