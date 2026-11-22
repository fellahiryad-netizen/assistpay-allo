import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { TreasuryComputation } from "@/features/treasury/lib/compute";
import { DECISION_AID_MENTION } from "@/features/treasury/lib/hypotheses";
import { NATURE_LABELS } from "@/features/treasury/lib/payables";
import { millions } from "@/features/treasury/lib/format";
import type { CollectionRow } from "@/features/treasury/lib/receivables";
import { formatDA, formatDate } from "@/utils/format";

const SOURCES = { facture: "Facture", simulation: "Simulation", demande: "Demande (à confirmer)" } as const;

/** Échéancier « Paiements à venir » : date, bénéficiaire, nature, montant, source, solde cumulé, et totaux par nature. */
export function ScheduleTable({ computation, requestsIncluded }: Readonly<{ computation: TreasuryComputation; requestsIncluded: boolean }>): React.JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Paiements à venir</CardTitle>
        <CardDescription>
          {computation.schedule.length} paiement{computation.schedule.length > 1 ? "s" : ""} pour {formatDA(computation.totalToPay)}. Les factures sans échéance fixée sont datées du jour du solde. Les demandes de paiement et les virements préparés n&apos;y sont pas additionnés
          {requestsIncluded ? " (les demandes sans facture liée sont ici incluses)" : ""}.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="max-h-[32rem] overflow-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date prévue</TableHead>
                <TableHead>Bénéficiaire</TableHead>
                <TableHead className="hidden md:table-cell">Nature</TableHead>
                <TableHead className="text-right">Montant</TableHead>
                <TableHead className="hidden sm:table-cell">Source</TableHead>
                <TableHead className="text-right">Solde après</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {computation.schedule.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                    Aucun paiement à venir.
                  </TableCell>
                </TableRow>
              ) : null}
              {computation.schedule.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="whitespace-nowrap">{formatDate(row.date)}</TableCell>
                  <TableCell>
                    <span className="font-medium">{row.beneficiaire}</span>
                    <span className="block text-xs text-muted-foreground md:hidden">{NATURE_LABELS[row.nature]}</span>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{NATURE_LABELS[row.nature]}</TableCell>
                  <TableCell className="whitespace-nowrap text-right tabular-nums">{formatDA(row.montant)}</TableCell>
                  <TableCell className="hidden sm:table-cell">
                    {SOURCES[row.source]}
                    {row.source === "simulation" ? <Badge variant="muted" className="ml-1">{row.certain ? "certain" : "estimé"}</Badge> : null}
                  </TableCell>
                  <TableCell className={`whitespace-nowrap text-right font-semibold tabular-nums ${row.balanceAfter < 0 ? "text-destructive" : ""}`}>{formatDA(row.balanceAfter)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={3} className="font-bold">
                  Total à payer
                </TableCell>
                <TableCell className="text-right font-bold tabular-nums">{formatDA(computation.totalToPay)}</TableCell>
                <TableCell colSpan={2} />
              </TableRow>
            </TableFooter>
          </Table>
        </div>
        <h3 className="mt-4 text-sm font-semibold">Totaux par nature</h3>
        <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
          {computation.byNature.map((row) => (
            <li key={row.nature} className="flex justify-between gap-3 border-b py-1">
              <span>
                {row.label} <span className="text-muted-foreground">({row.count})</span>
              </span>
              <b className="tabular-nums">{formatDA(row.total)}</b>
            </li>
          ))}
        </ul>
        {computation.preparedCount > 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Dont déjà dans des virements préparés (lots en attente d&apos;exécution, sous-ensemble du reste à payer, jamais additionné) : <b>{formatDA(computation.preparedTotal)}</b> ({computation.preparedCount} lot{computation.preparedCount > 1 ? "s" : ""}).
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** Ordre de priorité de paiement conseillé, avec la mention d'aide à la décision. */
export function PriorityBlock({ computation }: Readonly<{ computation: TreasuryComputation }>): React.JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Ordre de paiement conseillé</CardTitle>
        <CardDescription>{DECISION_AID_MENTION}</CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="space-y-2 text-sm">
          {computation.priority.map((group, index) => (
            <li key={group.rank} className="flex flex-wrap items-baseline justify-between gap-2 rounded-md border p-2">
              <span>
                <b>{index + 1}.</b> {group.label}
                {group.oldestDays !== null ? <span className="text-muted-foreground"> (facture la plus ancienne : {group.oldestDays} j)</span> : null}
              </span>
              <span className="tabular-nums">
                {group.count} paiement{group.count > 1 ? "s" : ""} · <b>{formatDA(group.total)}</b>
              </span>
            </li>
          ))}
          {computation.priority.length === 0 ? <li className="text-muted-foreground">Aucun paiement à ordonner.</li> : null}
        </ol>
      </CardContent>
    </Card>
  );
}

/** Encaissements attendus (non garantis) par compagnie. Désactivé par défaut : « scénario prudent, non compté ». */
export function ExpectedTable({ rows, enabled }: Readonly<{ rows: CollectionRow[]; enabled: boolean }>): React.JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Encaissements attendus (non garantis)</CardTitle>
        <CardDescription>
          {enabled
            ? "Option activée : date attendue = date de facture + délai médian de la compagnie, décote de 20 %. Rien n'est compté pour une facture déjà en retard, trop ancienne ou d'une compagnie à échantillon trop faible. Attendu, non garanti."
            : "Scénario prudent : aucun encaissement n'est compté. Les délais ci-dessous sont donnés à titre d'information."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Compagnie</TableHead>
                <TableHead className="text-right">Factures</TableHead>
                <TableHead className="text-right">Créances</TableHead>
                <TableHead className="text-right">Délai médian</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Échantillon</TableHead>
                <TableHead className="text-right">{enabled ? "Retenu (hachuré)" : "Compté"}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.company}>
                  <TableCell className="font-medium">{row.company === "AUTRES" ? "Autres" : row.company}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.count}</TableCell>
                  <TableCell className="text-right tabular-nums">{millions(row.total)}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.medianDays === null ? "n.d." : `${Math.round(row.medianDays)} j`}</TableCell>
                  <TableCell className="hidden text-right tabular-nums sm:table-cell">
                    {row.sample}
                    {row.weakSample ? <Badge variant="warning" className="ml-1">faible</Badge> : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{enabled ? (row.counted > 0 ? `${millions(row.counted)} (${row.countedCount})` : "rien") : "non compté"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
