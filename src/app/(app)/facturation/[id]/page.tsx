import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Copy, Pencil, Printer } from "lucide-react";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { Notice } from "@/components/common/notice";
import { PageHeader } from "@/components/common/page-header";
import { StateMessage } from "@/components/common/state-message";
import { buttonVariants } from "@/components/ui/button";
import { InvoiceDocument } from "@/features/billing/components/invoice-document";
import { getIssued } from "@/features/billing/services/billing-service";

export const metadata: Metadata = { title: "Facture établie" };

/** Facture établie : aperçu, impression, duplication, rectification (administrateur). */
export default async function IssuedPage({
  params,
  searchParams,
}: Readonly<{ params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }>): Promise<React.JSX.Element> {
  const user = await requireUser();
  const { id } = await params;
  const raw = await searchParams;
  const parsed = z.string().min(1).max(64).safeParse(id);
  if (!parsed.success) notFound();
  const result = await getIssued(user, parsed.data);
  if (!result.success) {
    if (result.code === "NOT_FOUND") notFound();
    return <StateMessage kind={result.code === "FORBIDDEN" ? "forbidden" : "error"} title="Facture inaccessible" message={result.error} />;
  }
  const { draft } = result.data;
  return (
    <>
      <PageHeader
        title={`Facture ${[draft.num, draft.num2].filter(Boolean).join(" / ")}`}
        description={draft.cli.nom}
        actions={
          <>
            <Link href="/facturation" className={buttonVariants({ variant: "ghost" })}>
              <ArrowLeft />
              Retour
            </Link>
            <Link href={`/imprimer/factures?ids=${result.data.id}`} target="_blank" className={buttonVariants({ variant: "outline" })}>
              <Printer />
              Imprimer (PDF)
            </Link>
            {result.data.canEdit ? (
              <Link href={`/facturation/nouvelle?dupliquer=${result.data.id}`} className={buttonVariants({ variant: "outline" })}>
                <Copy />
                Dupliquer
              </Link>
            ) : null}
            {result.data.isAdmin ? (
              <Link href={`/facturation/${result.data.id}/rectifier`} className={buttonVariants({ variant: "outline" })}>
                <Pencil />
                Rectifier
              </Link>
            ) : null}
          </>
        }
      />
      {raw.enregistre === "1" ? <Notice tone="success" className="mb-4">Facture enregistrée et ajoutée aux factures clients en attente de paiement.</Notice> : null}
      {result.data.versions ? <Notice tone="info" className="mb-4">Facture rectifiée {result.data.versions} fois (versions précédentes conservées).</Notice> : null}
      <div className="overflow-x-auto rounded-lg border bg-muted p-4">
        <div className="flex flex-col gap-6">
          <InvoiceDocument draft={draft} />
        </div>
      </div>
    </>
  );
}
