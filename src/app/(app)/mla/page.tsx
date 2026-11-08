import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/common/page-header";
import { StateMessage } from "@/components/common/state-message";
import { can } from "@/features/access/services/access-rules";
import { MlaHistory } from "@/features/mla/components/mla-history";
import { getMlaParamsByYear, listMlaHistory } from "@/features/mla/services/mla-store";
import { MlaCalc } from "@/features/mla/components/mla-calc";

export const metadata: Metadata = { title: "Facture MLA" };

/** Facture mensuelle MLA : flotte du mois, retraits et véhicules sinistrés. */
export default async function MlaPage(): Promise<React.JSX.Element> {
  const user = await requireUser();
  if (!can(user, "FACT", "VIEW")) return <StateMessage kind="forbidden" title="Facture MLA indisponible" message="Cet onglet demande l'accès « Établir une facture »." />;
  const history = await listMlaHistory(user);
  return (
    <>
      <PageHeader
        title="Facture MLA"
        description="Déposez la flotte du mois et les activités : la mensualité (prime annuelle par véhicule) et les véhicules retirés sinistrés (prime mensuelle jusqu'en décembre) sont calculés, puis la facture s'ouvre au modèle MLA."
      />
      <MlaCalc canEdit={can(user, "FACT", "EDIT")} isAdmin={user.isAdmin} paramsByYear={await getMlaParamsByYear()} />
      <div className="mt-4">
        <MlaHistory entries={history.success ? history.data : []} />
      </div>
    </>
  );
}
