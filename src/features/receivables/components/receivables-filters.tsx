import Link from "next/link";
import { Download, Printer } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import type { ReceivablesQuery } from "@/features/receivables/schemas";
import { cn } from "@/utils/cn";

/** Propriétés de la barre de filtres. */
export interface ReceivablesFiltersProps {
  years: number[];
  query: ReceivablesQuery;
  canExport: boolean;
}

function paramsOf(query: ReceivablesQuery): string {
  const params = new URLSearchParams();
  if (query.annee) params.set("annee", String(query.annee));
  if (query.activite) params.set("activite", query.activite);
  const text = params.toString();
  return text ? `?${text}` : "";
}

/** Filtres (année de facture, activité) en formulaire GET, plus les boutons d'export et d'impression. */
export function ReceivablesFilters({ years, query, canExport }: Readonly<ReceivablesFiltersProps>): React.JSX.Element {
  const suffix = paramsOf(query);
  return (
    <form method="get" className="mb-5 flex flex-col gap-3 rounded-lg border bg-card p-3 sm:flex-row sm:flex-wrap sm:items-end print:hidden">
      <label className="flex flex-col gap-1 text-xs text-muted-foreground sm:w-44">
        Année de facture
        <NativeSelect name="annee" defaultValue={query.annee ? String(query.annee) : ""}>
          <option value="">Toutes les années</option>
          {years.map((year) => (
            <option key={year} value={year}>
              {year}
            </option>
          ))}
        </NativeSelect>
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground sm:w-44">
        Activité
        <NativeSelect name="activite" defaultValue={query.activite ?? ""}>
          <option value="">Toutes</option>
          <option value="ASSISTANCE">Assistance</option>
          <option value="BDG">BDG</option>
        </NativeSelect>
      </label>
      {query.detail ? <input type="hidden" name="detail" value={query.detail} /> : null}
      {query.anc ? <input type="hidden" name="anc" value={query.anc} /> : null}
      <button type="submit" className={cn(buttonVariants({ variant: "violet" }))}>
        Appliquer
      </button>
      <div className="flex flex-wrap gap-2 sm:ml-auto">
        {canExport ? (
          <a href={`/api/creances/export${suffix}`} className={buttonVariants({ variant: "outline" })}>
            <Download />
            Excel
          </a>
        ) : null}
        <Link href={`/imprimer/creances${suffix}`} target="_blank" className={buttonVariants({ variant: "outline" })}>
          <Printer />
          Version imprimable
        </Link>
      </div>
    </form>
  );
}
