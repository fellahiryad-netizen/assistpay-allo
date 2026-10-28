import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/common/page-header";
import { StateMessage } from "@/components/common/state-message";
import { buttonVariants } from "@/components/ui/button";
import { DpEditor } from "@/features/payment-requests/components/dp-editor";
import { dpIdSchema } from "@/features/payment-requests/schemas";
import { getRequest } from "@/features/payment-requests/services/payment-request-service";

export const metadata: Metadata = { title: "Demande de paiement" };

/** Fiche d'une demande de paiement. */
export default async function RequestPage({ params }: Readonly<{ params: Promise<{ id: string }> }>): Promise<React.JSX.Element> {
  const user = await requireUser();
  const { id } = await params;
  const parsed = dpIdSchema.safeParse(id);
  if (!parsed.success) notFound();
  const result = await getRequest(user, parsed.data);
  if (!result.success) {
    if (result.code === "NOT_FOUND") notFound();
    return <StateMessage kind={result.code === "FORBIDDEN" ? "forbidden" : "error"} title="Demande inaccessible" message={result.error} />;
  }
  return (
    <>
      <PageHeader
        title={`Demande de paiement n° ${result.data.request.ref}`}
        description={result.data.request.beneficiaire}
        actions={
          <Link href="/demandes" className={buttonVariants({ variant: "ghost" })}>
            <ArrowLeft />
            Retour à la liste
          </Link>
        }
      />
      <DpEditor request={result.data.request} canEdit={result.data.canEdit} isAdmin={result.data.isAdmin} />
    </>
  );
}
