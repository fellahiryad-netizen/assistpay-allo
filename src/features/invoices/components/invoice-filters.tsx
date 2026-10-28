import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import type { InvoiceQuery } from "@/features/invoices/schemas";
import { INVOICE_STATUS_KEYS, SENS_LABELS, STATUS_LABELS, type InvoiceFilterOptions } from "@/features/invoices/types";

/** Propriétés des filtres de la liste. */
export interface InvoiceFiltersProps {
  query: InvoiceQuery;
  options: InvoiceFilterOptions;
}

/**
 * Filtres de la liste des factures. Formulaire GET : les filtres vivent dans l'URL
 * (partageables, conservés au rechargement) et fonctionnent sans JavaScript.
 */
export function InvoiceFilters({ query, options }: Readonly<InvoiceFiltersProps>): React.JSX.Element {
  return (
    <form method="get" className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-6" role="search">
      <div className="relative sm:col-span-2">
        <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input name="q" defaultValue={query.q ?? ""} placeholder="Tiers, numéro, libellé…" className="pl-9" aria-label="Recherche" />
      </div>
      <NativeSelect name="sens" defaultValue={query.sens ?? ""} aria-label="Sens">
        {options.sens.length > 1 ? <option value="">Crédit et débit</option> : null}
        {options.sens.map((sens) => (
          <option key={sens} value={sens}>
            {SENS_LABELS[sens]}
          </option>
        ))}
      </NativeSelect>
      <NativeSelect name="status" defaultValue={query.status ?? ""} aria-label="État">
        <option value="">Tous les états</option>
        {INVOICE_STATUS_KEYS.map((status) => (
          <option key={status} value={status}>
            {STATUS_LABELS[status]}
          </option>
        ))}
      </NativeSelect>
      <NativeSelect name="annee" defaultValue={query.annee ? String(query.annee) : ""} aria-label="Année">
        <option value="">Toutes les années</option>
        {options.years.map((year) => (
          <option key={year} value={year}>
            {year}
          </option>
        ))}
      </NativeSelect>
      <NativeSelect name="categorie" defaultValue={query.categorie ?? ""} aria-label="Catégorie">
        <option value="">Toutes les catégories</option>
        {options.categories.map((categorie) => (
          <option key={categorie} value={categorie}>
            {categorie}
          </option>
        ))}
      </NativeSelect>
      <div className="flex gap-2 sm:col-span-2 lg:col-span-6 lg:justify-end">
        <Button type="submit" className="flex-1 sm:flex-none">
          Filtrer
        </Button>
        <Button type="reset" variant="ghost" asChild>
          <a href={query.sens ? `/factures?sens=${query.sens}` : "/factures"}>Réinitialiser</a>
        </Button>
      </div>
    </form>
  );
}
