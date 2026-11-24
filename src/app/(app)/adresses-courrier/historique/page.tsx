import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { can } from "@/features/access/services/access-rules";
import { Notice } from "@/components/common/notice";
import { PageHeader } from "@/components/common/page-header";
import { StateMessage } from "@/components/common/state-message";
import { CourrierTabs } from "@/features/courrier/components/courrier-tabs";
import { EnvoiHistory } from "@/features/courrier/components/envoi-history";
import { overdueEnvois } from "@/features/courrier/lib/envois";
import { envoiFiltersSchema } from "@/features/courrier/schemas";
import { listEnvois } from "@/features/courrier/services/envoi-service";
import { todayIso } from "@/utils/dates";

export const metadata: Metadata = { title: "Historique des bordereaux" };

/** Historique des bordereaux d'envoi : ce qui a été envoyé, où, et à quelle date EMS a ramassé. */
export default async function EnvoiHistoryPage({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>): Promise<React.JSX.Element> {
  const user = await requireUser();
  const raw = await searchParams;
  const one = (value: string | string[] | undefined): string => (Array.isArray(value) ? (value[0] ?? "") : (value ?? ""));
  const filters = envoiFiltersSchema.parse({ q: one(raw.q), du: one(raw.du), au: one(raw.au), ramasse: one(raw.ramasse), statut: one(raw.statut), compagnie: one(raw.compagnie) });
  const result = await listEnvois(user);
  if (!result.success) return <StateMessage kind={result.code === "FORBIDDEN" ? "forbidden" : "error"} title="Historique indisponible" message={result.error} />;
  const today = todayIso();
  const late = overdueEnvois(result.data.envois, today).length;
  return (
    <>
      <PageHeader title="Historique des bordereaux" description="Chaque bordereau établi avec sa date de création et la date à laquelle EMS a ramassé le courrier." />
      <CourrierTabs current="historique" />
      {late > 0 ? (
        <Notice tone="warning" className="mb-4">
          {late} bordereau{late > 1 ? "x" : ""} sans date de ramassage depuis plus de 2 jours.
        </Notice>
      ) : null}
      <EnvoiHistory envois={result.data.envois} canEdit={result.data.canEdit} canExport={can(user, "A_EXPORT", "EDIT")} today={today} initialFilters={filters} />
    </>
  );
}
