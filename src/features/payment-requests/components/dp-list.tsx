import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { PaymentRequestDTO } from "@/features/payment-requests/types";
import { formatDA, formatDate } from "@/utils/format";

/** Liste des demandes de paiement. */
export function DpList({ items }: Readonly<{ items: PaymentRequestDTO[] }>): React.JSX.Element {
  return (
    <div className="rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>N°</TableHead>
            <TableHead>Bénéficiaire et pièces</TableHead>
            <TableHead className="text-right">Montant</TableHead>
            <TableHead className="hidden md:table-cell">Produit</TableHead>
            <TableHead>Paiement</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((request) => (
            <TableRow key={request.id}>
              <TableCell className="whitespace-nowrap">
                <Link href={`/demandes/${request.id}`} className="font-semibold hover:underline">
                  {request.ref}
                </Link>
                {request.status === "a_valider" ? <span className="block text-xs font-medium text-warning">Nouvelle, à valider</span> : null}
                {request.date ? <span className="block text-xs text-muted-foreground">{formatDate(request.date)}</span> : null}
              </TableCell>
              <TableCell className="max-w-96">
                <span className="block truncate font-medium">{request.beneficiaire || "—"}</span>
                <span className="block truncate text-xs text-muted-foreground">{request.pieces.join(" ; ")}</span>
              </TableCell>
              <TableCell className="whitespace-nowrap text-right font-medium tabular-nums">{formatDA(request.montant)}</TableCell>
              <TableCell className="hidden whitespace-nowrap md:table-cell">
                {request.produit || "—"}
                <span className="block text-xs text-muted-foreground">{request.mode === "CHEQUE" ? "chèque" : request.mode ? "virement" : ""}</span>
              </TableCell>
              <TableCell>
                <Badge variant={request.payment.state === "payee" ? "success" : request.payment.state === "non_reliee" ? "muted" : "warning"}>{request.payment.label}</Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
