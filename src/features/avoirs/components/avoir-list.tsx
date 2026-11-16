"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { cancelAvoirAction } from "@/app/actions/avoir-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { AvoirDTO } from "@/features/avoirs/types";
import { formatDA, formatDate } from "@/utils/format";

const SUITE: Readonly<Record<string, string>> = { aucune: "", remboursement: "Remboursement", imputation: "Imputation" };

/** Avoirs émis, avec impression et annulation. */
export function AvoirList({ items, canEdit }: Readonly<{ items: AvoirDTO[]; canEdit: boolean }>): React.JSX.Element {
  const [pending, startTransition] = useTransition();
  const [cancelling, setCancelling] = useState("");
  const [motif, setMotif] = useState("");
  const [error, setError] = useState("");

  function cancel(id: string): void {
    setError("");
    startTransition(async () => {
      const result = await cancelAvoirAction({ id, motif });
      if (!result.success) return setError(result.error);
      setCancelling("");
      setMotif("");
    });
  }

  if (items.length === 0) return <p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">Aucun avoir émis pour l&apos;instant.</p>;
  return (
    <div className="rounded-lg border bg-card">
      {error ? (
        <p role="alert" className="p-3 text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Avoir</TableHead>
            <TableHead>Date</TableHead>
            <TableHead>Compagnie</TableHead>
            <TableHead>Sur la facture</TableHead>
            <TableHead className="text-right">TTC</TableHead>
            <TableHead>Motif</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow key={item.id} className={item.annule ? "opacity-60" : undefined}>
              <TableCell className="whitespace-nowrap font-medium">
                {item.num}
                {item.annule ? <Badge variant="muted" className="ml-2">annulé</Badge> : null}
              </TableCell>
              <TableCell className="whitespace-nowrap tabular-nums">{formatDate(item.date)}</TableCell>
              <TableCell>{item.clientLabel}</TableCell>
              <TableCell className="whitespace-nowrap">{item.origineNum}</TableCell>
              <TableCell className="whitespace-nowrap text-right font-medium tabular-nums">−{formatDA(item.ttc)}</TableCell>
              <TableCell className="max-w-72">
                <span className="block truncate">{item.motif}</span>
                {SUITE[item.suite] ? <span className="block text-xs text-muted-foreground">{SUITE[item.suite]}</span> : null}
              </TableCell>
              <TableCell className="whitespace-nowrap text-right">
                <Link href={`/imprimer/avoirs?id=${item.id}`} target="_blank" className="mr-3 text-sm font-medium underline">
                  Imprimer
                </Link>
                {canEdit && !item.annule ? (
                  cancelling === item.id ? (
                    <span className="inline-flex items-center gap-2">
                      <Input aria-label="Motif de l'annulation" className="h-8 w-48" placeholder="Motif de l'annulation" value={motif} onChange={(event) => setMotif(event.target.value)} />
                      <Button type="button" size="sm" variant="destructive" disabled={pending} onClick={() => cancel(item.id)}>
                        Confirmer
                      </Button>
                    </span>
                  ) : (
                    <Button type="button" size="sm" variant="outline" onClick={() => { setCancelling(item.id); setMotif(""); setError(""); }}>
                      Annuler
                    </Button>
                  )
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
