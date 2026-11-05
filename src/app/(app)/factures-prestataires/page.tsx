import type { Metadata } from "next";
import { PageHeader } from "@/components/common/page-header";
import { StateMessage } from "@/components/common/state-message";
import { can } from "@/features/access/services/access-rules";
import { FpApp } from "@/features/provider-invoices/components/fp-app";
import { fpOverview } from "@/features/provider-invoices/services/fp-store";
import { requireUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Demande facture prestataire" };

/** Suivi des factures que les prestataires font cacheter et signer : demande, établissement, envoi, original reçu, paiement. */
export default async function ProviderInvoicesPage(): Promise<React.JSX.Element> {
  const user = await requireUser();
  const result = await fpOverview(user);
  if (!result.success) return <StateMessage kind={result.code === "FORBIDDEN" ? "forbidden" : "error"} title="Demandes de facture prestataire indisponibles" message={result.error} />;
  return (
    <>
      <PageHeader title="Demande facture prestataire" description="Du numéro pris au portail jusqu'au paiement : demande enregistrée, facture établie et envoyée, original reçu, à payer." />
      <FpApp data={result.data} canEdit={can(user, "FFOUR", "EDIT")} />
    </>
  );
}
