import Link from "next/link";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import { cn } from "@/utils/cn";
import { formatDA } from "@/utils/format";

/** Entrée de la barre, avec le lien déjà calculé par la page. */
export interface ClassificationBarEntry {
  value: string;
  label: string;
  count: number;
  total: number;
  active: boolean;
  href: string;
}

/** Propriétés d'une ligne de classement. */
export interface ClassificationRowProps {
  title: string;
  /** Nom du paramètre d'URL (utilisé par la liste déroulante quand il y a beaucoup d'entrées). */
  param: string;
  entries: ClassificationBarEntry[];
  /** Paramètres à conserver quand on choisit dans la liste déroulante. */
  hidden: Record<string, string>;
}

/** Au-delà de ce nombre d'entrées, la ligne devient une liste déroulante (fournisseurs, anciens mois). */
const MAX_CHIPS = 12;

function Row({ title, param, entries, hidden }: Readonly<ClassificationRowProps>): React.JSX.Element {
  const active = entries.find((entry) => entry.active);
  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-3">
      <p className="w-28 shrink-0 pt-1.5 text-sm font-medium text-muted-foreground">{title}</p>
      {entries.length > MAX_CHIPS ? (
        <form method="get" className="flex flex-1 flex-wrap items-center gap-2" role="search" aria-label={title}>
          {Object.entries(hidden).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          <div className="min-w-0 flex-1 sm:max-w-md">
            <NativeSelect name={param} defaultValue={active?.value ?? ""} aria-label={title}>
              {entries.map((entry) => (
                <option key={entry.value} value={entry.value}>
                  {`${entry.label} (${entry.count}) – ${formatDA(entry.total)}`}
                </option>
              ))}
            </NativeSelect>
          </div>
          <Button type="submit" variant="outline">
            Afficher
          </Button>
        </form>
      ) : (
        <div className="flex flex-1 flex-wrap gap-1.5">
          {entries.map((entry) => (
            <Link
              key={entry.value}
              href={entry.href}
              aria-current={entry.active ? "true" : undefined}
              className={cn(
                "flex flex-col rounded-md border px-3 py-1.5 text-sm leading-tight transition-colors",
                entry.active ? "border-primary bg-primary/10 text-primary" : "bg-card hover:border-primary",
                entry.count === 0 && !entry.active && "opacity-60",
              )}
            >
              <span className="font-medium">
                {entry.label} <span className="font-normal text-muted-foreground">({entry.count})</span>
              </span>
              <span className="text-xs tabular-nums text-muted-foreground">{formatDA(entry.total)}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/** Propriétés de la barre de classement. */
export interface InvoiceClassificationBarProps {
  groupTitle: string;
  groups: ClassificationBarEntry[];
  months: ClassificationBarEntry[];
  /** Paramètres d'URL à conserver dans les listes déroulantes (hors `p` et `mois`). */
  hiddenForGroups: Record<string, string>;
  hiddenForMonths: Record<string, string>;
}

/**
 * Barre de classement à deux niveaux, sans dossiers : Partenaire (ou Fournisseur) puis Mois.
 * Chaque choix est un simple lien (paramètres d'URL), avec le nombre de factures et le total.
 */
export function InvoiceClassificationBar({ groupTitle, groups, months, hiddenForGroups, hiddenForMonths }: Readonly<InvoiceClassificationBarProps>): React.JSX.Element {
  return (
    <section aria-label="Classement" className="mb-4 flex flex-col gap-2 rounded-lg border bg-card p-3">
      <Row title={groupTitle} param="p" entries={groups} hidden={hiddenForGroups} />
      <Row title="Mois" param="mois" entries={months} hidden={hiddenForMonths} />
    </section>
  );
}
