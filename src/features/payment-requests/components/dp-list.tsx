"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Printer, Trash2 } from "lucide-react";
import { deleteRequestsBulkAction } from "@/app/actions/payment-request-actions";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { PaymentRequestDTO } from "@/features/payment-requests/types";
import { formatDA, formatDate } from "@/utils/format";

/** Liste des demandes de paiement. */
export function DpList({ items, isAdmin = false }: Readonly<{ items: PaymentRequestDTO[]; isAdmin?: boolean }>): React.JSX.Element {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const allChecked = items.length > 0 && items.every((request) => selected.has(request.id));

  function toggle(id: string): void {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function remove(ids: string[]): void {
    if (!window.confirm(`Supprimer définitivement ${ids.length} demande(s) de paiement ? Les factures liées restent, sans demande.`)) return;
    startTransition(async () => {
      const result = await deleteRequestsBulkAction({ ids });
      if (!result.success) return setMessage(result.error);
      setMessage([`${result.data.done} demande(s) supprimée(s)`, result.data.failures.length ? `${result.data.failures.length} refusée(s) : ${result.data.failures.join(" / ")}` : ""].filter(Boolean).join(". ") + ".");
      setSelected(new Set());
    });
  }

  return (
    <div className="rounded-lg border bg-card">
      {message ? (
        <p role="status" className="border-b p-3 text-sm font-medium">
          {message}
        </p>
      ) : null}
      {isAdmin && selected.size > 0 ? (
        <div className="flex items-center gap-3 border-b p-3">
          <span className="text-sm font-medium">{selected.size} demande(s) sélectionnée(s)</span>
          <Button type="button" size="sm" variant="destructive" disabled={pending} onClick={() => remove([...selected])}>
            <Trash2 />
            Supprimer
          </Button>
        </div>
      ) : null}
      <Table>
        <TableHeader>
          <TableRow>
            {isAdmin ? (
              <TableHead className="w-8">
                <input type="checkbox" className="size-4 cursor-pointer accent-primary" checked={allChecked} onChange={() => setSelected(allChecked ? new Set() : new Set(items.map((request) => request.id)))} aria-label="Tout sélectionner" />
              </TableHead>
            ) : null}
            <TableHead>N°</TableHead>
            <TableHead>Bénéficiaire et pièces</TableHead>
            <TableHead className="text-right">Montant</TableHead>
            <TableHead className="hidden md:table-cell">Produit</TableHead>
            <TableHead>Paiement</TableHead>
            <TableHead className="text-right">PDF</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((request) => (
            <TableRow key={request.id} data-state={selected.has(request.id) ? "selected" : undefined}>
              {isAdmin ? (
                <TableCell>
                  <input type="checkbox" className="size-4 cursor-pointer accent-primary" checked={selected.has(request.id)} onChange={() => toggle(request.id)} aria-label={`Sélectionner ${request.ref}`} />
                </TableCell>
              ) : null}
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
              <TableCell className="space-x-2 whitespace-nowrap text-right">
                {isAdmin ? (
                  <Button type="button" size="sm" variant="outline" disabled={pending} title={`Supprimer la demande ${request.ref}`} aria-label={`Supprimer la demande ${request.ref}`} onClick={() => remove([request.id])}>
                    <Trash2 />
                  </Button>
                ) : null}
                <Link
                  href={`/imprimer/demandes?ids=${request.id}`}
                  target="_blank"
                  title={`Imprimer la demande ${request.ref} en PDF`}
                  aria-label={`Imprimer la demande ${request.ref}`}
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  <Printer />
                  PDF
                </Link>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
