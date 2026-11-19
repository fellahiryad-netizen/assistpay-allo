import Link from "next/link";
import { Card } from "@/components/ui/card";
import { ACTIVITY_LABELS } from "@/features/invoices/lib/activity";
import type { ActivityGroup } from "@/features/invoices/lib/provider-activity";
import { cn } from "@/utils/cn";
import { formatDA } from "@/utils/format";

/** Propriétés d'une carte indicateur d'activité. */
export interface ProviderActivityKpiProps {
  group: ActivityGroup;
  /** Lien : filtre sur cette activité, ou retour à toutes les activités si elle est déjà choisie. */
  href: string;
  active: boolean;
}

/** Carte cliquable : reste à payer, factures impayées et prestataires en attente d'une activité. */
export function ProviderActivityKpi({ group, href, active }: Readonly<ProviderActivityKpiProps>): React.JSX.Element {
  const label = ACTIVITY_LABELS[group.activity];
  return (
    <Link href={href} aria-current={active ? "true" : undefined} aria-label={`${label} : ${formatDA(group.due)} à payer, ${group.providers} prestataire(s) en attente. ${active ? "Afficher toutes les activités" : `Afficher seulement ${label}`}`} className="group block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <Card className={cn("h-full p-4 transition-colors group-hover:bg-muted/50", active && "border-primary bg-primary/5")}>
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <p className={cn("mt-1 text-2xl font-semibold tabular-nums", group.due > 0 ? "text-destructive" : "")}>{formatDA(group.due)}</p>
        <p className="mt-2 text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">{group.providers}</span> prestataire(s) en attente · <span className="font-semibold text-foreground">{group.pending}</span> facture(s) impayée(s)
        </p>
      </Card>
    </Link>
  );
}
