import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/common/page-header";
import { StateMessage } from "@/components/common/state-message";
import { can } from "@/features/access/services/access-rules";
import { ReceivablesFilters } from "@/features/receivables/components/receivables-filters";
import { ReceivablesView } from "@/features/receivables/components/receivables-view";
import { receivablesQuerySchema } from "@/features/receivables/schemas";
import { getReceivables } from "@/features/receivables/services/receivables-service";
import { formatDate } from "@/utils/format";

export const metadata: Metadata = { title: "Créances par compagnie" };

/** Vue globale des créances : factures partenaires en attente, par compagnie. */
export default async function ReceivablesPage({ searchParams }: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>): Promise<React.JSX.Element> {
  const user = await requireUser();
  const raw = await searchParams;
  const one = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value) || undefined;
  const query = receivablesQuerySchema.parse({ annee: one(raw.annee), activite: one(raw.activite) });
  const result = await getReceivables(user, query);
  if (!result.success) {
    return (
      <StateMessage
        kind={result.code === "FORBIDDEN" ? "forbidden" : "error"}
        title={result.code === "FORBIDDEN" ? "Les créances ne font pas partie de vos accès" : "Créances indisponibles"}
        message={result.error}
      />
    );
  }
  const { summary, years } = result.data;
  return (
    <>
      <PageHeader title="Créances par compagnie" description={`Factures partenaires en attente d'encaissement, situation au ${formatDate(summary.asOf)}.`} />
      <ReceivablesFilters years={years} query={result.data.query} canExport={can(user, "A_EXPORT", "EDIT")} />
      <ReceivablesView summary={summary} query={result.data.query} />
    </>
  );
}
