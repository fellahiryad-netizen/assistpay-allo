import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/common/page-header";
import { StateMessage } from "@/components/common/state-message";
import { can } from "@/features/access/services/access-rules";
import { InvoiceForm } from "@/features/invoices/components/invoice-form";
import { invoiceIdSchema } from "@/features/invoices/schemas";
import { getInvoice, getInvoiceFilterOptions } from "@/features/invoices/services/invoice-service";
import type { SensKey } from "@/features/invoices/types";
import { todayIso } from "@/utils/dates";

export const metadata: Metadata = { title: "Modifier la facture" };

/** Modification d'une facture. */
export default async function EditInvoicePage({ params }: Readonly<{ params: Promise<{ id: string }> }>): Promise<React.JSX.Element> {
  const user = await requireUser();
  const { id } = await params;
  const parsedId = invoiceIdSchema.safeParse(id);
  if (!parsedId.success) notFound();
  const [result, options] = await Promise.all([getInvoice(user, parsedId.data), getInvoiceFilterOptions(user)]);
  if (!result.success) {
    if (result.code === "NOT_FOUND") notFound();
    return <StateMessage kind="error" title="Facture inaccessible" message={result.error} />;
  }
  if (!result.data.canEdit) {
    return <StateMessage kind="forbidden" title="Modification non autorisée" message="Vous pouvez consulter cette facture mais pas la modifier." />;
  }
  const allowed: SensKey[] = [];
  if (can(user, "FCLI", "EDIT")) allowed.push("CREDIT");
  if (can(user, "FFOUR", "EDIT")) allowed.push("DEBIT");
  const { invoice } = result.data;
  return (
    <>
      <PageHeader title="Modifier la facture" description={`${invoice.tiers}${invoice.numero ? ` · ${invoice.numero}` : ""}`} />
      <InvoiceForm
        invoice={invoice}
        defaultSens={invoice.sens}
        allowedSens={allowed}
        categories={options.success ? options.data.categories : []}
        today={todayIso()}
        cancelHref={`/factures/${invoice.id}`}
      />
    </>
  );
}
