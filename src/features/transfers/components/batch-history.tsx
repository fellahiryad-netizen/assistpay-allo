import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { TransferBatchDTO } from "@/features/transfers/types";
import { round2 } from "@/utils/amounts";
import { formatDA, formatDate } from "@/utils/format";

const STATUS: Readonly<Record<string, { label: string; variant: "success" | "warning" | "destructive" | "muted" }>> = {
  valide: { label: "Validé", variant: "success" },
  attente: { label: "En attente", variant: "warning" },
  rejete: { label: "Rejeté", variant: "destructive" },
};

/** Historique des envois de virements. */
export function BatchHistory({ batches }: Readonly<{ batches: TransferBatchDTO[] }>): React.JSX.Element {
  return (
    <div className="rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Mois</TableHead>
            <TableHead>Envoi</TableHead>
            <TableHead className="hidden md:table-cell">Activité</TableHead>
            <TableHead className="text-right">Débit</TableHead>
            <TableHead className="hidden text-right lg:table-cell">Écart</TableHead>
            <TableHead className="text-right">Virements</TableHead>
            <TableHead>Statut</TableHead>
            <TableHead className="hidden md:table-cell">Relevé</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {batches.map((batch) => {
            const status = STATUS[batch.status] ?? { label: batch.status || "—", variant: "muted" as const };
            const gap = round2(batch.debit - batch.credit);
            return (
              <TableRow key={batch.id}>
                <TableCell className="whitespace-nowrap">
                  {batch.mois} {batch.annee ?? ""}
                </TableCell>
                <TableCell>
                  <Link href={`/virements/${batch.id}`} className="font-medium hover:underline">
                    {batch.ref || batch.fichier}
                  </Link>
                  <span className="block text-xs text-muted-foreground">{batch.src === "consolide" ? "consolidé" : batch.fichier}</span>
                </TableCell>
                <TableCell className="hidden md:table-cell">{batch.produit}</TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums">{formatDA(batch.debit)}</TableCell>
                <TableCell className={gap ? "hidden text-right text-destructive lg:table-cell" : "hidden text-right text-muted-foreground lg:table-cell"}>{gap ? formatDA(gap) : "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{batch.nb}</TableCell>
                <TableCell>
                  <Badge variant={status.variant}>{status.label}</Badge>
                </TableCell>
                <TableCell className="hidden text-xs md:table-cell">{batch.statement ? `${formatDate(batch.statement.date)} (${batch.statement.status === "A_TRAITER" ? "à rapprocher" : "rapproché"})` : "—"}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
