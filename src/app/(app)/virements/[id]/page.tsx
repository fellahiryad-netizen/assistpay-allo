import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/common/page-header";
import { StateMessage } from "@/components/common/state-message";
import { buttonVariants } from "@/components/ui/button";
import { BatchDetail } from "@/features/transfers/components/batch-detail";
import { getBatch } from "@/features/transfers/services/transfer-service";

export const metadata: Metadata = { title: "Envoi de virements" };

/** Détail et contrôle d'un envoi de virements. */
export default async function BatchPage({
  params,
  searchParams,
}: Readonly<{ params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }>): Promise<React.JSX.Element> {
  const user = await requireUser();
  const { id } = await params;
  const raw = await searchParams;
  const parsed = z.string().min(1).max(64).safeParse(id);
  if (!parsed.success) notFound();
  const result = await getBatch(user, parsed.data);
  if (!result.success) {
    if (result.code === "NOT_FOUND") notFound();
    return <StateMessage kind={result.code === "FORBIDDEN" ? "forbidden" : "error"} title="Envoi inaccessible" message={result.error} />;
  }
  const { batch } = result.data;
  return (
    <>
      <PageHeader
        title={`Envoi « ${batch.ref || batch.fichier} »`}
        description={`${batch.produit} · ${batch.mois} ${batch.annee ?? ""}`}
        actions={
          <Link href="/virements" className={buttonVariants({ variant: "ghost" })}>
            <ArrowLeft />
            Retour aux envois
          </Link>
        }
      />
      <BatchDetail batch={batch} analysis={result.data.analysis} canEdit={result.data.canEdit} isAdmin={result.data.isAdmin} justGenerated={raw.genere === "1"} />
    </>
  );
}
