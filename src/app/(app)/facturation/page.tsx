import type { Metadata } from "next";
import Link from "next/link";
import { FilePlus2 } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/common/page-header";
import { StateMessage } from "@/components/common/state-message";
import { buttonVariants } from "@/components/ui/button";
import { can } from "@/features/access/services/access-rules";
import { IssuedList } from "@/features/billing/components/issued-list";
import { listIssued } from "@/features/billing/services/billing-service";

export const metadata: Metadata = { title: "Établir une facture" };

/** Factures établies et accès à l'éditeur. */
export default async function BillingPage(): Promise<React.JSX.Element> {
  const user = await requireUser();
  const result = await listIssued(user, "all");
  if (!result.success) return <StateMessage kind={result.code === "FORBIDDEN" ? "forbidden" : "error"} title="Facturation indisponible" message={result.error} />;
  return (
    <>
      <PageHeader
        title="Établir une facture"
        description="Modèles de votre fichier de facturation (GAM, TRUST, MLA, CAAT, CAAR, TDA…). Chaque facture enregistrée s'ajoute aux factures clients en attente."
        actions={
          can(user, "FACT", "EDIT") ? (
            <Link href="/facturation/nouvelle" className={buttonVariants()}>
              <FilePlus2 />
              Nouvelle facture
            </Link>
          ) : undefined
        }
      />
      {result.data.length ? <IssuedList items={result.data} /> : <StateMessage kind="empty" title="Aucune facture établie pour l'instant" />}
    </>
  );
}
