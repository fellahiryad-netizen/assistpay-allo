import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/common/page-header";
import { StateMessage } from "@/components/common/state-message";
import { buttonVariants } from "@/components/ui/button";
import { BordereauEditor } from "@/features/courrier/components/bordereau-editor";
import { pickBranches } from "@/features/courrier/lib/address-book";
import { buildBordereauLines } from "@/features/courrier/lib/bordereau";
import { envelopeQuerySchema } from "@/features/courrier/schemas";
import { getAddressBook } from "@/features/courrier/services/courrier-service";
import { todayIso } from "@/utils/dates";

export const metadata: Metadata = { title: "Bordereau d'envoi" };

/** Aperçu modifiable du bordereau d'envoi pour les succursales choisies (`ids`), avant impression. */
export default async function BordereauPreviewPage({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>): Promise<React.JSX.Element> {
  const user = await requireUser();
  const raw = await searchParams;
  const parsed = envelopeQuerySchema.safeParse({ ids: Array.isArray(raw.ids) ? raw.ids.join(",") : (raw.ids ?? "") });
  const back = (
    <Link href="/adresses-courrier" className={buttonVariants({ variant: "ghost" })}>
      <ArrowLeft />
      Adresses courrier
    </Link>
  );
  if (!parsed.success) return <StateMessage kind="error" title="Aucune succursale choisie" message="Cochez une ou plusieurs succursales dans la page « Adresses courrier »." action={back} />;
  const result = await getAddressBook(user);
  if (!result.success) return <StateMessage kind={result.code === "FORBIDDEN" ? "forbidden" : "error"} title="Bordereau indisponible" message={result.error} />;
  const branches = pickBranches(result.data.branches, parsed.data.ids);
  if (branches.length === 0) return <StateMessage kind="empty" title="Succursale introuvable" message="Ces fiches ont peut-être été supprimées." action={back} />;
  return (
    <>
      <PageHeader title="Bordereau d'envoi" description="Vérifiez et complétez le bordereau, puis imprimez-le sur le papier à en-tête avant de remettre les enveloppes à EMS." actions={back} />
      <BordereauEditor initialLines={buildBordereauLines(branches)} initialDate={todayIso()} />
    </>
  );
}
