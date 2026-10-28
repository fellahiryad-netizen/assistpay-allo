import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { IssuedInvoiceDTO } from "@/features/billing/types";
import { formatDA, formatDate } from "@/utils/format";

/** Factures établies dans AssistPay. */
export function IssuedList({ items }: Readonly<{ items: IssuedInvoiceDTO[] }>): React.JSX.Element {
  return (
    <div className="rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>N°</TableHead>
            <TableHead>Date</TableHead>
            <TableHead>Client</TableHead>
            <TableHead className="hidden lg:table-cell">Modèle / période</TableHead>
            <TableHead className="text-right">TTC</TableHead>
            <TableHead>Suivi</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow key={item.id}>
              <TableCell className="whitespace-nowrap">
                <Link href={`/facturation/${item.id}`} className="font-medium hover:underline">
                  {[item.num, item.num2].filter(Boolean).join(" / ")}
                </Link>
                {item.rectifications ? <span className="block text-xs text-warning">rectifiée {item.rectifications} fois</span> : null}
              </TableCell>
              <TableCell className="whitespace-nowrap tabular-nums">{formatDate(item.date)}</TableCell>
              <TableCell>{item.clientLabel}</TableCell>
              <TableCell className="hidden max-w-96 lg:table-cell">
                <span className="block truncate">{item.presetLabel}</span>
                <span className="block text-xs text-muted-foreground">{item.perTxt}</span>
              </TableCell>
              <TableCell className="whitespace-nowrap text-right font-medium tabular-nums">{formatDA(item.ttc)}</TableCell>
              <TableCell>
                {item.invoiceStatus ? (
                  <Badge variant={item.invoiceStatus === "REGLE" ? "success" : item.invoiceStatus === "ANNULE" ? "muted" : "warning"}>
                    {item.invoiceStatus === "REGLE" ? "Réglée" : item.invoiceStatus === "ANNULE" ? "Annulée" : "En attente"}
                  </Badge>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
