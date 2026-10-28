import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/common/page-header";
import { Pagination } from "@/components/common/pagination";
import { StateMessage } from "@/components/common/state-message";
import { TabsNav } from "@/components/common/tabs-nav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DpImportDialog } from "@/features/payment-requests/components/dp-import-dialog";
import { DpList } from "@/features/payment-requests/components/dp-list";
import { NewRequestButton } from "@/features/payment-requests/components/new-request-button";
import { dpQuerySchema, type DpQuery } from "@/features/payment-requests/schemas";
import { listRequests } from "@/features/payment-requests/services/payment-request-service";
import { formatDA } from "@/utils/format";

export const metadata: Metadata = { title: "Demandes de paiement" };

function href(query: DpQuery, page: number): string {
  const params = new URLSearchParams({ filtre: query.filtre });
  if (query.q) params.set("q", query.q);
  if (page > 1) params.set("page", String(page));
  return `/demandes?${params.toString()}`;
}

/** Demandes de paiement des prestataires. */
export default async function RequestsPage({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>): Promise<React.JSX.Element> {
  const user = await requireUser();
  const raw = await searchParams;
  const one = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value) || undefined;
  const query = dpQuerySchema.parse({ filtre: one(raw.filtre), q: one(raw.q), page: one(raw.page) });
  const result = await listRequests(user, query);
  if (!result.success) {
    return <StateMessage kind={result.code === "FORBIDDEN" ? "forbidden" : "error"} title="Demandes de paiement indisponibles" message={result.error} />;
  }
  const data = result.data;
  return (
    <>
      <PageHeader
        title="Demandes de paiement"
        description={`Prochaine demande : n° ${data.nextRef} · ${data.total} demande(s), total ${formatDA(data.sumMontant)}`}
        actions={
          data.canEdit ? (
            <>
              <DpImportDialog />
              <NewRequestButton />
            </>
          ) : undefined
        }
      />
      <TabsNav
        tabs={[
          { href: href({ ...query, filtre: "a_valider" }, 1), label: "À valider", active: query.filtre === "a_valider", count: data.toValidate },
          { href: href({ ...query, filtre: "non_payee" }, 1), label: "Non payées", active: query.filtre === "non_payee" },
          { href: href({ ...query, filtre: "toutes" }, 1), label: "Toutes", active: query.filtre === "toutes" },
        ]}
      />
      <form method="get" className="mb-4 flex gap-2" role="search">
        <input type="hidden" name="filtre" value={query.filtre} />
        <Input name="q" defaultValue={query.q ?? ""} placeholder="N°, bénéficiaire, montant…" aria-label="Rechercher une demande" className="sm:max-w-sm" />
        <Button type="submit" variant="outline">
          Rechercher
        </Button>
      </form>
      {data.items.length === 0 ? (
        <StateMessage kind="empty" title={query.filtre === "a_valider" ? "Aucune demande en attente de validation" : "Aucune demande"} />
      ) : (
        <>
          <DpList items={data.items} />
          <Pagination page={data.page} pageCount={data.pageCount} hrefFor={(page) => href(query, page)} />
        </>
      )}
    </>
  );
}
