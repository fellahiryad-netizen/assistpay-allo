import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/common/page-header";
import { StateMessage } from "@/components/common/state-message";
import { can } from "@/features/access/services/access-rules";
import { MlaHistory } from "@/features/mla/components/mla-history";
import { MlaFiles, MlaPrimes } from "@/features/mla/components/mla-fiche";
import { getMlaParamsByYear, listMlaFiles, listMlaHistory, listMlaPrimes } from "@/features/mla/services/mla-store";
import { MlaCalc } from "@/features/mla/components/mla-calc";

export const metadata: Metadata = { title: "Facture MLA" };

/** Facture mensuelle MLA : flotte du mois, retraits et véhicules sinistrés. */
export default async function MlaPage(): Promise<React.JSX.Element> {
  const user = await requireUser();
  if (!can(user, "FACT", "VIEW")) return <StateMessage kind="forbidden" title="Facture MLA indisponible" message="Cet onglet demande l'accès « Établir une facture »." />;
  const [history, files, primes] = await Promise.all([listMlaHistory(user), listMlaFiles(user), listMlaPrimes()]);
  return (
    <>
      <PageHeader
        title="Facture MLA"
        description="Déposez la flotte du mois et les activités : la mensualité (prime annuelle par véhicule) et les véhicules retirés sinistrés (prime mensuelle jusqu'en décembre) sont calculés, puis la facture s'ouvre au modèle MLA."
      />
      <MlaCalc canEdit={can(user, "FACT", "EDIT")} isAdmin={user.isAdmin} paramsByYear={await getMlaParamsByYear()} />
      <div className="mt-4 flex flex-col gap-4">
        <MlaHistory entries={history.success ? history.data : []} />
        <MlaFiles files={files.success ? files.data : []} />
        <MlaPrimes rows={primes} />
      </div>
    </>
  );
}
