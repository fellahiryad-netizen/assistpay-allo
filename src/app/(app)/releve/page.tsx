import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/common/page-header";
import { Pagination } from "@/components/common/pagination";
import { StateMessage } from "@/components/common/state-message";
import { TabsNav } from "@/components/common/tabs-nav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { getInvoiceFilterOptions } from "@/features/invoices/services/invoice-service";
import { StatementImporter } from "@/features/statement/components/statement-importer";
import { StatementLines } from "@/features/statement/components/statement-lines";
import { statementQuerySchema, type StatementQuery } from "@/features/statement/schemas";
import { listStatementLines } from "@/features/statement/services/statement-service";
import { STATEMENT_STATUS_KEYS, STATEMENT_STATUS_LABELS } from "@/features/statement/types";

export const metadata: Metadata = { title: "Relevé bancaire" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (value: string | string[] | undefined): string | undefined => {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === "" ? undefined : raw;
};

function historyHref(query: StatementQuery, page: number): string {
  const params = new URLSearchParams({ onglet: "historique" });
  if (query.status) params.set("status", query.status);
  if (query.sens) params.set("sens", query.sens);
  if (query.month) params.set("month", query.month);
  if (query.q) params.set("q", query.q);
  if (page > 1) params.set("page", String(page));
  return `/releve?${params.toString()}`;
}

/** Relevé bancaire : import et rapprochement, lignes à traiter, historique. */
export default async function StatementPage({ searchParams }: Readonly<{ searchParams: SearchParams }>): Promise<React.JSX.Element> {
  const user = await requireUser();
  const raw = await searchParams;
  const tab = first(raw.onglet) ?? "a-traiter";
  const query = statementQuerySchema.parse({
    status: tab === "a-traiter" ? "A_TRAITER" : first(raw.status),
    sens: first(raw.sens),
    month: first(raw.month),
    q: first(raw.q),
    page: first(raw.page),
  });
  const [result, options] = await Promise.all([listStatementLines(user, query), getInvoiceFilterOptions(user)]);
  if (!result.success) {
    return (
      <>
        <PageHeader title="Relevé bancaire" />
        <StateMessage kind={result.code === "FORBIDDEN" ? "forbidden" : "error"} title="Relevé indisponible" message={result.error} />
      </>
    );
  }
  const data = result.data;
  const todoCount = data.counts.A_TRAITER ?? 0;
  const tabs = [
    ...(data.canEdit ? [{ href: "/releve?onglet=importer", label: "Importer et rapprocher", active: tab === "importer" }] : []),
    { href: "/releve?onglet=a-traiter", label: "À traiter", active: tab === "a-traiter", count: todoCount },
    { href: "/releve?onglet=historique", label: "Historique", active: tab === "historique" },
  ];
  const categories = options.success ? options.data.categories : [];

  return (
    <>
      <PageHeader title="Relevé bancaire" description="Import du relevé, rapprochement avec les factures et suivi des paiements absents du suivi." />
      <TabsNav tabs={tabs} />
      {tab === "importer" && data.canEdit ? <StatementImporter /> : null}
      {tab === "a-traiter" ? (
        data.items.length === 0 ? (
          <StateMessage kind="empty" title="Rien à traiter" message="Tous les paiements du relevé sont rapprochés ou classés." />
        ) : (
          <>
            <p className="mb-3 text-sm text-muted-foreground">
              Paiements du relevé absents du suivi : affectez-les à une facture, ajoutez-les au suivi ou ignorez-les.
            </p>
            <StatementLines lines={data.items} canEdit={data.canEdit} categories={categories} />
            <Pagination page={data.page} pageCount={data.pageCount} hrefFor={(page) => `/releve?onglet=a-traiter&page=${page}`} />
          </>
        )
      ) : null}
      {tab === "historique" ? (
        <>
          <form method="get" className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5" role="search">
            <input type="hidden" name="onglet" value="historique" />
            <Input name="q" defaultValue={query.q ?? ""} placeholder="Libellé, n° de chèque…" aria-label="Recherche" className="lg:col-span-2" />
            <NativeSelect name="status" defaultValue={query.status ?? ""} aria-label="Statut">
              <option value="">Tous les statuts</option>
              {STATEMENT_STATUS_KEYS.map((status) => (
                <option key={status} value={status}>
                  {STATEMENT_STATUS_LABELS[status]} ({data.counts[status] ?? 0})
                </option>
              ))}
            </NativeSelect>
            <NativeSelect name="sens" defaultValue={query.sens ?? ""} aria-label="Sens">
              <option value="">Entrées et sorties</option>
              <option value="CREDIT">Entrées (crédit)</option>
              <option value="DEBIT">Sorties (débit)</option>
            </NativeSelect>
            <Input name="month" type="month" defaultValue={query.month ?? ""} aria-label="Mois" />
            <div className="flex justify-end sm:col-span-2 lg:col-span-5">
              <Button type="submit">Filtrer</Button>
            </div>
          </form>
          {data.items.length === 0 ? (
            <StateMessage kind="empty" title="Aucune ligne" />
          ) : (
            <>
              <StatementLines lines={data.items} canEdit={data.canEdit} categories={categories} />
              <Pagination page={data.page} pageCount={data.pageCount} hrefFor={(page) => historyHref(query, page)} />
            </>
          )}
        </>
      ) : null}
    </>
  );
}
