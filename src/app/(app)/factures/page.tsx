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
import { InvoiceClassificationBar, type ClassificationBarEntry } from "@/features/invoices/components/invoice-classification-bar";
import { InvoiceFilters } from "@/features/invoices/components/invoice-filters";
import { InvoiceTable } from "@/features/invoices/components/invoice-table";
import { invoiceQuerySchema, type InvoiceQuery } from "@/features/invoices/schemas";
import { getInvoiceClassification } from "@/features/invoices/services/invoice-classification";
import { getInvoiceFilterOptions, listInvoices } from "@/features/invoices/services/invoice-service";
import { monthLabel } from "@/features/invoices/lib/classification";
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
  if (query.activite) params.set("activite", query.activite);
  if (query.q) params.set("q", query.q);
  if (query.m) params.set("m", query.m);
  if (query.succursale) params.set("succursale", query.succursale);
  if (query.d) params.set("d", query.d);
  if (query.p) params.set("p", query.p);
  if (query.mois) params.set("mois", query.mois);
  return `/api/factures/export?${params.toString()}`;
}

function toSearch(query: InvoiceQuery, page: number): string {
  const params = new URLSearchParams();
  if (query.sens) params.set("sens", query.sens);
  if (query.status) params.set("status", query.status);
  if (query.annee) params.set("annee", String(query.annee));
  if (query.categorie) params.set("categorie", query.categorie);
  if (query.activite) params.set("activite", query.activite);
  if (query.q) params.set("q", query.q);
  if (query.m) params.set("m", query.m);
  if (query.succursale) params.set("succursale", query.succursale);
  if (query.d) params.set("d", query.d);
  if (query.p) params.set("p", query.p);
  if (query.mois) params.set("mois", query.mois);
  if (page > 1) params.set("page", String(page));
  const search = params.toString();
  return search ? `/factures?${search}` : "/factures";
}

/** Paramètres de l'URL à conserver dans un formulaire de classement (tous sauf celui qu'on change). */
function hiddenFields(query: InvoiceQuery, omit: "p" | "mois"): Record<string, string> {
  const fields: Record<string, string | undefined> = {
    sens: query.sens,
    status: query.status,
    annee: query.annee ? String(query.annee) : undefined,
    categorie: query.categorie,
    activite: query.activite,
    succursale: query.succursale,
    q: query.q,
    d: query.d,
    p: omit === "p" ? undefined : query.p,
    mois: omit === "mois" ? undefined : query.mois,
  };
  return Object.fromEntries(Object.entries(fields).filter((entry): entry is [string, string] => Boolean(entry[1])));
}

/** Entrées de la barre de classement avec leurs liens (le mois choisi est toujours écrit dans l'URL). */
function classificationProps(
  query: InvoiceQuery,
  groups: ReadonlyArray<{ value: string; label: string; count: number; total: number; active: boolean }>,
  months: ReadonlyArray<{ value: string; label: string; count: number; total: number; active: boolean }>,
): { groupTitle: string; groups: ClassificationBarEntry[]; months: ClassificationBarEntry[]; hiddenForGroups: Record<string, string>; hiddenForMonths: Record<string, string> } {
  return {
    groupTitle: query.sens === "DEBIT" ? "Fournisseur" : "Partenaire",
    groups: groups.map((entry) => ({ ...entry, href: toSearch({ ...query, p: entry.value || undefined }, 1) })),
    months: months.map((entry) => ({ ...entry, href: toSearch({ ...query, mois: entry.value }, 1) })),
    hiddenForGroups: hiddenFields(query, "p"),
    hiddenForMonths: hiddenFields(query, "mois"),
  };
}

const TITLES = { CREDIT: "Factures partenaires", DEBIT: "Factures fournisseurs" } as const;

/** Liste filtrable et paginée des factures. */
export default async function InvoicesPage({ searchParams }: Readonly<{ searchParams: SearchParams }>): Promise<React.JSX.Element> {
  const user = await requireUser();
  const raw = await searchParams;
  const parsed = invoiceQuerySchema.parse({
    sens: first(raw.sens),
    status: first(raw.status),
    succursale: first(raw.succursale),
    annee: first(raw.annee),
    categorie: first(raw.categorie),
    activite: first(raw.activite),
    q: first(raw.q),
    m: first(raw.m),
    d: first(raw.d),
    p: first(raw.p),
    mois: first(raw.mois),
    page: first(raw.page),
  });
  // Si le sens a été changé dans le formulaire de filtres, le partenaire / fournisseur choisi n'a plus de sens : on l'abandonne.
  const previousSens = first(raw.sens0);
  if (previousSens !== undefined && previousSens !== (parsed.sens ?? "-")) parsed.p = undefined;
  // Classement simple (partenaire / fournisseur puis mois) : seulement sur les vues partenaires et fournisseurs, et jamais pendant une recherche par montant.
  const classified = Boolean(parsed.sens) && !parsed.m;
  // Le mois courant est proposé seulement à l'arrivée sur la vue : dès qu'une recherche ou un filtre est posé, on cherche partout.
  // L'onglet « À régler » ne reçoit jamais de mois par défaut (il masquerait des impayés) ; `!parsed.status` l'exclut déjà.
  const fresh = !parsed.mois && !parsed.p && !parsed.q && !parsed.d && !parsed.annee && !parsed.categorie && !parsed.activite && !parsed.succursale && !parsed.status;
  const classification = classified ? await getInvoiceClassification(user, parsed, fresh) : null;
  const flat = { ...parsed, p: undefined, mois: undefined };
  const query: InvoiceQuery = classification?.success ? { ...parsed, p: classification.data.p || undefined, mois: classification.data.mois } : classified ? parsed : flat;
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
          { href: toSearch({ ...query, status: undefined }, 1), label: "Toutes", active: !query.status, count: classification?.success ? classification.data.tabs.TOUTES : undefined },
          // Les impayés ne sont jamais limités à un mois par défaut : seul un mois choisi explicitement dans l'URL est conservé.
          { href: toSearch({ ...query, status: "EN_ATTENTE", mois: parsed.mois }, 1), label: "À régler", active: query.status === "EN_ATTENTE", count: classification?.success ? (parsed.mois ? classification.data.tabs.A_REGLER : classification.data.unpaidAllMonths) : undefined },
          { href: toSearch({ ...query, status: "REGLE" }, 1), label: "Réglées", active: query.status === "REGLE", count: classification?.success ? classification.data.tabs.REGLEES : undefined },
          ...(query.sens === "CREDIT" && can(user, "FACT", "VIEW") ? [{ href: "/avoirs", label: "Avoirs", active: false }] : []),
        ]}
      />
      {classification?.success && query.status !== "EN_ATTENTE" && classification.data.mois !== "tous" ? (
        <p className="mb-3 rounded-md border border-border bg-muted/50 px-3 py-2 text-sm" role="status">
          <span className="font-medium">Mois : {monthLabel(classification.data.mois)}</span> —{" "}
          <Link href={toSearch({ ...query, mois: "tous" }, 1)} className="underline underline-offset-2">
            voir tous les mois
          </Link>
        </p>
      ) : null}
      {classification?.success ? <InvoiceClassificationBar {...classificationProps(query, classification.data.groups, classification.data.months)} /> : null}
      <InvoiceFilters query={query} options={options.data} />
      {data.cumul ? (
        <div className="mb-3 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
          <p className="font-medium">
            Aucune facture ne porte ce montant seul : c'est un virement cumulé de plusieurs factures (tous statuts confondus).
          </p>
          <ul className="mt-1 list-disc pl-5 text-muted-foreground">
            {data.cumul.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {data.items.length === 0 ? (
        <StateMessage kind="empty" title="Aucune facture ne correspond" message="Modifiez les filtres ou la recherche." />
      ) : (
        <>
          <InvoiceTable items={data.items} canEdit={data.canEdit} today={todayIso()} showSens={!query.sens} printable={data.printable} cumulPaid={data.cumulPaid} avoirs={data.avoirs} isAdmin={user.isAdmin} />
          <Pagination page={data.page} pageCount={data.pageCount} hrefFor={(page) => toSearch(query, page)} />
        </>
      )}
    </>
  );
}
