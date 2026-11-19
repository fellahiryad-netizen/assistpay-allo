import Link from "next/link";
import { DonutChart } from "@/components/common/donut-chart";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChangeActivityDialog } from "@/features/invoices/components/change-activity-dialog";
import { ACTIVITY_LABELS } from "@/features/invoices/lib/activity";
import { visibleProviders, type ActivityGroup } from "@/features/invoices/lib/provider-activity";
import { formatDA, formatDate } from "@/utils/format";

/** Propriétés d'une section d'activité de la page des prestataires. */
export interface ProviderActivitySectionProps {
  group: ActivityGroup;
  showSettled: boolean;
  /** Peut modifier les factures fournisseurs (bouton « Changer l'activité »). */
  canEdit: boolean;
  /** Année du filtre affiché, s'il y en a un. */
  year?: number;
  /** Texte d'introduction sous le titre. */
  description: string;
}

const MAX_ROWS = 300;
/** Nom affiché pour un prestataire sans tiers : il n'y a rien à rechercher dans la liste des factures. */
const NO_NAME = "Sans nom";

function invoicesHref(tiers: string, activity: ActivityGroup["activity"], year: number | undefined): string {
  const params = new URLSearchParams({ sens: "DEBIT", activite: activity, q: tiers });
  if (year) params.set("annee", String(year));
  return `/factures?${params.toString()}`;
}

/** Section « Assistance », « BDG » ou « Autre » : donut du reste à payer par prestataire et tableau des soldes. */
export function ProviderActivitySection({ group, showSettled, canEdit, year, description }: Readonly<ProviderActivitySectionProps>): React.JSX.Element {
  const label = ACTIVITY_LABELS[group.activity];
  const rows = visibleProviders(group.items, showSettled);
  const slices = group.items.filter((item) => item.due > 0).map((item) => ({ label: item.tiers, amount: item.due, count: item.pending }));
  const headingId = `section-${group.activity}`;
  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-4">
      <Card>
        <CardHeader className="gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle id={headingId} className="text-lg">
              {label}
            </CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant={group.due > 0 ? "destructive" : "success"}>{formatDA(group.due)} à payer</Badge>
            <Badge variant="muted">{group.providers} prestataire(s) en attente</Badge>
            <Badge variant="muted">{group.pending} facture(s) impayée(s)</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <DonutChart slices={slices} centerLabel={`À payer · ${label}`} />
        </CardContent>
      </Card>
      <div className="overflow-x-auto rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Prestataire</TableHead>
              <TableHead className="text-right">Facturé</TableHead>
              <TableHead className="text-right">Réglé</TableHead>
              <TableHead className="text-right">Reste à payer</TableHead>
              <TableHead className="text-right">Impayées</TableHead>
              <TableHead>Dernier règlement</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-6 text-center text-sm text-muted-foreground">
                  {group.items.length === 0 ? `Aucune facture fournisseur en ${label}.` : `Aucun prestataire en attente de paiement en ${label}. Activez « Afficher les soldés » pour voir les autres.`}
                </TableCell>
              </TableRow>
            ) : null}
            {rows.slice(0, MAX_ROWS).map((item) => (
              <TableRow key={item.tiers}>
                <TableCell className="max-w-64 truncate font-medium">{item.tiers}</TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums">{formatDA(item.invoiced)}</TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums">{formatDA(item.paid)}</TableCell>
                <TableCell className={`whitespace-nowrap text-right font-semibold tabular-nums ${item.due > 0 ? "text-destructive" : ""}`}>{formatDA(item.due)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {item.pending || "—"}
                  {item.oldestDays ? <span className="block text-xs text-muted-foreground">{item.oldestDays} j</span> : null}
                </TableCell>
                <TableCell className="whitespace-nowrap tabular-nums">{formatDate(item.lastPaid)}</TableCell>
                <TableCell className="whitespace-nowrap text-right">
                  {item.tiers !== NO_NAME ? (
                    <Link href={invoicesHref(item.tiers, group.activity, year)} className={buttonVariants({ size: "sm", variant: "outline" })}>
                      Factures
                    </Link>
                  ) : null}
                  {item.due > 0 ? (
                    <Link href="/demandes" className={`${buttonVariants({ size: "sm", variant: "ghost" })} ml-1`}>
                      Payer
                    </Link>
                  ) : null}
                  {canEdit && item.pending > 0 ? <ChangeActivityDialog tiers={item.tiers} from={group.activity} count={item.pending} year={year} /> : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {rows.length > MAX_ROWS ? <p className="text-xs text-muted-foreground">Les {MAX_ROWS} premiers prestataires sur {rows.length} sont affichés : affinez avec la recherche.</p> : null}
    </section>
  );
}
