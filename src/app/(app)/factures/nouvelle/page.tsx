import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/common/page-header";
import { StateMessage } from "@/components/common/state-message";
import { can } from "@/features/access/services/access-rules";
import { InvoiceForm } from "@/features/invoices/components/invoice-form";
import { getInvoiceFilterOptions } from "@/features/invoices/services/invoice-service";
import type { SensKey } from "@/features/invoices/types";
import { todayIso } from "@/utils/dates";

export const metadata: Metadata = { title: "Nouvelle facture" };

/** Ajout d'une facture. */
export default async function NewInvoicePage({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>): Promise<React.JSX.Element> {
  const user = await requireUser();
  const raw = await searchParams;
  const allowed: SensKey[] = [];
  if (can(user, "FCLI", "EDIT")) allowed.push("CREDIT");
  if (can(user, "FFOUR", "EDIT")) allowed.push("DEBIT");
  if (allowed.length === 0) {
    return <StateMessage kind="forbidden" title="Accès refusé" message="Vous n'avez le droit de modifier aucun type de facture." />;
  }
  const requested = raw.sens === "CREDIT" || raw.sens === "DEBIT" ? raw.sens : null;
  const defaultSens = requested && allowed.includes(requested) ? requested : allowed.length === 1 ? (allowed[0] ?? null) : null;
  const options = await getInvoiceFilterOptions(user);
  return (
    <>
      <PageHeader title="Nouvelle facture" description="Facture client (crédit) ou fournisseur (débit)." />
      <InvoiceForm
        invoice={null}
        defaultSens={defaultSens}
        allowedSens={allowed}
        categories={options.success ? options.data.categories : []}
        today={todayIso()}
        cancelHref={defaultSens ? `/factures?sens=${defaultSens}` : "/factures"}
      />
    </>
  );
}
