import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { can } from "@/features/access/services/access-rules";
import { PageHeader } from "@/components/common/page-header";
import { StateMessage } from "@/components/common/state-message";
import { RegulWorkbench } from "@/features/regul/components/regul-workbench";
import { todayIso } from "@/utils/dates";

export const metadata: Metadata = { title: "CAAT Régul 10 %" };

/** Régularisation trimestrielle 10 % HT + TVA des succursales CAAT. */
export default async function RegulPage(): Promise<React.JSX.Element> {
  const user = await requireUser();
  if (!can(user, "FCLI", "VIEW")) return <StateMessage kind="forbidden" title="Accès refusé" message="Vous n'avez pas accès aux factures clients." />;
  return (
    <>
      <PageHeader
        title="CAAT Régul 10 %"
        description="Déposez les fichiers « arrêté comptablement » d'une succursale : le calcul du 10 % HT + TVA se fait seul, avec le contrôle des annulations et des changements de garantie, puis vous récupérez le classeur."
      />
      <RegulWorkbench defaultYear={Number(todayIso().slice(0, 4))} canExport={can(user, "A_EXPORT", "EDIT")} />
    </>
  );
}
