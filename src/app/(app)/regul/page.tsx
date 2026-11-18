import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { can } from "@/features/access/services/access-rules";
import { PageHeader } from "@/components/common/page-header";
import { StateMessage } from "@/components/common/state-message";
import { RegulApp } from "@/features/regul/components/regul-app";
import { RegulPolices } from "@/features/regul/components/regul-polices";
import { parsePolicesQuery } from "@/features/regul/services/regul-polices-query";
import { regulPolices } from "@/features/regul/services/regul-polices-store";
import { regulOverview } from "@/features/regul/services/regul-store";

export const metadata: Metadata = { title: "CAAT Régul 10 %" };

/** Régularisation des avances 90 % HT des succursales CAAT : 10 % HT + TVA, suivi, contrôle qualité et bases de données. */
export default async function RegulPage({ searchParams }: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>): Promise<React.JSX.Element> {
  const user = await requireUser();
  const raw = await searchParams;
  const onPolices = raw.onglet === "polices";
  const params = parsePolicesQuery(raw);
  const polices = onPolices ? await regulPolices(user, params) : null;
  const result = await regulOverview(user);
  if (!result.success) return <StateMessage kind={result.code === "FORBIDDEN" ? "forbidden" : "error"} title="CAAT Régul 10 % indisponible" message={result.error} />;
  return (
    <>
      <PageHeader
        title="CAAT Régul 10 %"
        description="Régularisation des avances 90 % HT des succursales CAAT : comparaison ligne à ligne avec la production, contrôle des annulations et des sinistres, calcul du 10 % HT + TVA et export du classeur."
      />
      <RegulApp overview={result.data} isAdmin={user.isAdmin} canEdit={can(user, "FCLI", "EDIT")} canExport={can(user, "A_EXPORT", "EDIT")}
        initialTab={onPolices ? "polices" : undefined}
        policesSlot={<RegulPolices view={polices?.success ? polices.data : null} params={params} error={polices && !polices.success ? polices.error : null} canExport={can(user, "A_EXPORT", "EDIT")} />}
      />
    </>
  );
}
