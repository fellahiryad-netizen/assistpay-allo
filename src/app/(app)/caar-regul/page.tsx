import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { can } from "@/features/access/services/access-rules";
import { PageHeader } from "@/components/common/page-header";
import { StateMessage } from "@/components/common/state-message";
import { CaarRegulApp } from "@/features/caar-regul/components/caar-regul-app";
import { caarRegulOverview } from "@/features/caar-regul/services/caar-regul-store";

export const metadata: Metadata = { title: "CAAR Régul 10 %" };

/** Régularisation des avances 90 % (réglées TTC) des succursales CAAR : écart HT + TVA 19 % sur l'écart, suivi et bases de données. */
export default async function CaarRegulPage(): Promise<React.JSX.Element> {
  const user = await requireUser();
  const result = await caarRegulOverview(user);
  if (!result.success) return <StateMessage kind={result.code === "FORBIDDEN" ? "forbidden" : "error"} title="CAAR Régul 10 % indisponible" message={result.error} />;
  return (
    <>
      <PageHeader
        title="CAAR Régul 10 %"
        description="Régularisation des avances 90 % des cinq succursales CAAR (Alger Chéraga, Alger Bouzaréah, Constantine, Annaba, Oran) : comparaison avec le consolidé, écarts police par police et par agence, alerte formule Tunisie, export du classeur et mail d'accompagnement."
      />
      <CaarRegulApp overview={result.data} isAdmin={user.isAdmin} canEdit={can(user, "FCLI", "EDIT")} canExport={can(user, "A_EXPORT", "EDIT")} signataire={user.name} />
    </>
  );
}
