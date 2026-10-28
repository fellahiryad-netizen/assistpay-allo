import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/common/page-header";
import { StateMessage } from "@/components/common/state-message";
import { BillingEditor } from "@/features/billing/components/billing-editor";
import { getIssued } from "@/features/billing/services/billing-service";

export const metadata: Metadata = { title: "Rectifier une facture" };

/** Rectification d'une facture émise (administrateurs, motif obligatoire). */
export default async function FixBillingPage({ params }: Readonly<{ params: Promise<{ id: string }> }>): Promise<React.JSX.Element> {
  const user = await requireUser();
  const { id } = await params;
  const parsed = z.string().min(1).max(64).safeParse(id);
  if (!parsed.success) notFound();
  const result = await getIssued(user, parsed.data);
  if (!result.success) {
    if (result.code === "NOT_FOUND") notFound();
    return <StateMessage kind="error" title="Facture inaccessible" message={result.error} />;
  }
  if (!result.data.isAdmin) return <StateMessage kind="forbidden" title="Rectification réservée" message="Facture émise : seul un administrateur peut la rectifier." />;
  return (
    <>
      <PageHeader title={`Rectifier la facture ${result.data.draft.num || result.data.draft.num2}`} description="La version actuelle est conservée dans l'historique de la facture." />
      <BillingEditor initial={result.data.draft} issuedId={result.data.id} canEdit />
    </>
  );
}
