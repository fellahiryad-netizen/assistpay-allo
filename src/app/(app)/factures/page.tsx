import type { Metadata } from "next";
import Link from "next/link";
import { Download, Plus } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { can } from "@/features/access/services/access-rules";
import { PageHeader } from "@/components/common/page-header";
import { Pagination } from "@/components/common/pagination";
import { StateMessage } from "@/components/common/state-message";
import { TabsNav } from "@/components/common/tabs-nav";
import { buttonVariants } from "@/components/ui/button";
import { SupplierImportDialog } from "@/features/payment-requests/components/supplier-import-dialog";
import { InvoiceImportDialog } from "@/features/invoices/components/invoice-import-dialog";
import { InvoiceFilters } from "@/features/invoices/components/invoice-filters";
import { InvoiceTable } from "@/features/invoices/components/invoice-table";
import { invoiceQuerySchema, type InvoiceQuery } from "@/features/invoices/schemas";
import { getInvoiceFilterOptions, listInvoices } from "@/features/invoices/services/invoice-service";
import { todayIso } from "@/utils/dates";
import { formatDA } from "@/utils/format";

export const metadata: Metadata = { title: "Factures" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === "" ? undefined : raw;
}

function exportHref(query: InvoiceQuery, format?: "suivi"): string {
  const params = new URLSearchParams();
  if (format) params.set("format", format);
  if (query.sens) params.set("sens", query.sens);
  if (query.status) params.set("status", query.status);
  if (query.annee) params.set("annee", String(query.annee));
  if (query.categorie) params.set("categorie", query.categorie);
  if (query.q) params.set("q", query.q);
  return `/api/factures/export?${params.toString()}`;
}

function toSearch(query: InvoiceQuery, page: number): string {
  const params = new URLSearchParams();
  if (query.sens) params.set("sens", query.sens);
  if (query.status) params.set("status", query.status);
  if (query.annee) params.set("annee", String(query.annee));
  if (query.categorie) params.set("categorie", query.categorie);
  if (query.q) params.set("q", query.q);
  if (page > 1) params.set("page", String(page));
  const search = params.toString();
  return search ? `/factures?${search}` : "/factures";
}

const TITLES = { CREDIT: "Factures clients", DEBIT: "Factures fournisseurs" } as const;

/** Liste filtrable et paginée des factures. */
export default async function InvoicesPage({ searchParams }: Readonly<{ searchParams: SearchParams }>): Promise<React.JSX.Element> {
  const user = await requireUser();
  const raw = await searchParams;
  const query = invoiceQuerySchema.parse({
    sens: first(raw.sens),
    status: first(raw.status),
    annee: first(raw.annee),
    categorie: first(raw.categorie),
    q: first(raw.q),
    page: first(raw.page),
  });
  const [result, options] = await Promise.all([listInvoices(user, query), getInvoiceFilterOptions(user)]);
  const title = query.sens ? TITLES[query.sens] : "Factures";

  if (!result.success || !options.success) {
    const failure = !result.success ? result : options.success ? null : options;
    return (
      <>
        <PageHeader title={title} />
        <StateMessage
          kind={failure?.code === "FORBIDDEN" ? "forbidden" : "error"}
          title={failure?.code === "FORBIDDEN" ? "Accès refusé" : "Liste indisponible"}
          message={failure?.error}
        />
      </>
    );
  }

  const data = result.data;
  const canAdd = query.sens ? data.canEdit[query.sens] : data.canEdit.CREDIT || data.canEdit.DEBIT;
  return (
    <>
      <PageHeader
        title={title}
        description={`${data.total.toLocaleString("fr-FR")} facture(s) · total ${formatDA(data.sumMontant)}`}
        actions={
          <div className="flex flex-wrap justify-end gap-2">
            {can(user, "A_EXPORT", "EDIT") ? (
              <>
                <a href={exportHref(query)} className={buttonVariants({ variant: "outline" })}>
                  <Download />
                  Exporter en Excel (liste affichée)
                </a>
                <a href={exportHref(query, "suivi")} className={buttonVariants({ variant: "outline" })} title="Toutes les lignes, dans les colonnes du classeur de suivi bancaire">
                  <Download />
                  Suivi complet (Excel)
                </a>
              </>
            ) : null}
            {canAdd && can(user, "A_IMPORT", "EDIT") ? <InvoiceImportDialog /> : null}
            {query.sens === "DEBIT" && canAdd && can(user, "DP", "EDIT") && can(user, "A_IMPORT", "EDIT") ? <SupplierImportDialog /> : null}
            {canAdd ? (
              <Link href={query.sens ? `/factures/nouvelle?sens=${query.sens}` : "/factures/nouvelle"} className={buttonVariants()}>
                <Plus />
                Nouvelle facture
              </Link>
            ) : null}
          </div>
        }
      />
      <TabsNav
        tabs={[
          { href: toSearch({ ...query, status: "EN_ATTENTE" }, 1), label: "En attente", active: query.status === "EN_ATTENTE" },
          { href: toSearch({ ...query, status: "REGLE" }, 1), label: "Réglées", active: query.status === "REGLE" },
          { href: toSearch({ ...query, status: undefined }, 1), label: "Tout", active: !query.status },
        ]}
      />
      <InvoiceFilters query={query} options={options.data} />
      {data.items.length === 0 ? (
        <StateMessage kind="empty" title="Aucune facture ne correspond" message="Modifiez les filtres ou la recherche." />
      ) : (
        <>
          <InvoiceTable items={data.items} canEdit={data.canEdit} today={todayIso()} showSens={!query.sens} />
          <Pagination page={data.page} pageCount={data.pageCount} hrefFor={(page) => toSearch(query, page)} />
        </>
      )}
    </>
  );
}
