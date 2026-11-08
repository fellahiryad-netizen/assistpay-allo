import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { MlaHistoryEntry } from "@/features/mla/services/mla-store";
import { formatDA } from "@/utils/format";

const STATUTS: Record<string, string> = { EN_ATTENTE: "En attente", REGLE: "Réglée" };

function when(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("fr-FR", { timeZone: "Africa/Algiers", dateStyle: "short", timeStyle: "short" });
}

/** Historique des factures MLA : qui les a créées, quand, pour quel mois et quel montant. */
export function MlaHistory({ entries }: Readonly<{ entries: MlaHistoryEntry[] }>): React.JSX.Element {
  return (
    <Card className="p-0">
      <div className="border-b p-3">
        <p className="text-sm font-medium">Historique des factures MLA établies ({entries.length})</p>
        <p className="text-xs text-muted-foreground">Chaque création, rectification et suppression figure aussi au journal.</p>
      </div>
      {entries.length ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Établie le</TableHead>
              <TableHead>Par</TableHead>
              <TableHead>N°</TableHead>
              <TableHead>Mois</TableHead>
              <TableHead className="text-right">Véhicules</TableHead>
              <TableHead className="text-right">Retraits sinistrés</TableHead>
              <TableHead className="text-right">TTC</TableHead>
              <TableHead>Suivi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((entry) => (
              <TableRow key={entry.id}>
                <TableCell className="whitespace-nowrap text-xs">{when(entry.creeLe)}</TableCell>
                <TableCell className="text-xs">{entry.creePar || "—"}</TableCell>
                <TableCell className="whitespace-nowrap">
                  <Link href={`/facturation/${entry.id}`} className="font-medium underline-offset-2 hover:underline">
                    {entry.num}
                  </Link>
                </TableCell>
                <TableCell className="text-xs">{entry.mois}</TableCell>
                <TableCell className="text-right tabular-nums">{entry.vehicules}</TableCell>
                <TableCell className="text-right tabular-nums">{entry.retraits}</TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums">{formatDA(entry.ttc)}</TableCell>
                <TableCell className="text-xs">
                  {STATUTS[entry.statut] ?? "—"}
                  {entry.rectifiee > 0 ? <Badge variant="warning" className="ml-1">rectifiée {entry.rectifiee}× par {entry.modifiePar}</Badge> : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <p className="p-4 text-sm text-muted-foreground">Aucune facture MLA établie pour le moment.</p>
      )}
    </Card>
  );
}
