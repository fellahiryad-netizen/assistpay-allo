"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { cancelAvoirAction } from "@/app/actions/avoir-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { AvoirDTO } from "@/features/avoirs/types";
import { formatDA, formatDate } from "@/utils/format";

const SUITE: Readonly<Record<string, string>> = { aucune: "", remboursement: "Remboursement", imputation: "Imputation" };

/** Avoirs émis, avec filtre par facture d'origine, impression et annulation. */
export function AvoirList({ items, canEdit, initialOrigineId = "" }: Readonly<{ items: AvoirDTO[]; canEdit: boolean; initialOrigineId?: string }>): React.JSX.Element {
  const [origineId, setOrigineId] = useState(initialOrigineId);
  const [search, setSearch] = useState("");
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

  const origins = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of items) if (item.origineId && !map.has(item.origineId)) map.set(item.origineId, `${item.origineNum} (${item.clientLabel})`);
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], "fr"));
  }, [items]);
  const text = search.trim().toLowerCase();
  const visible = items.filter((item) => (!origineId || item.origineId === origineId) && (!text || [item.num, item.origineNum, item.clientLabel, item.motif].join(" ").toLowerCase().includes(text)));
  const focus = origineId ? items.filter((item) => item.origineId === origineId) : [];
  const focusTotal = Math.round(focus.filter((item) => !item.annule).reduce((sum, item) => sum + item.ttc, 0) * 100) / 100;
  const focusTtc = focus[0]?.origineTtc ?? 0;

  if (items.length === 0) return <p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">Aucun avoir émis pour l&apos;instant.</p>;
  return (
    <div className="rounded-lg border bg-card">
      <div className="flex flex-wrap items-end gap-3 border-b p-3">
        <label className="flex flex-col gap-1 text-xs font-medium">
          Facture d&apos;origine
          <NativeSelect aria-label="Filtrer par facture d'origine" className="min-w-64" value={origineId} onChange={(event) => setOrigineId(event.target.value)}>
            <option value="">Toutes les factures</option>
            {origins.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium">
          Recherche
          <Input aria-label="Rechercher un avoir" className="h-10 w-56" placeholder="N° d'avoir, facture, motif…" value={search} onChange={(event) => setSearch(event.target.value)} />
        </label>
      </div>
      {origineId && focus.length > 0 ? (
        <p className="border-b p-3 text-sm" role="status">
          Facture <strong>{focus[0]?.origineNum}</strong> : TTC {formatDA(focusTtc)} · total des avoirs actifs <strong>−{formatDA(focusTotal)}</strong> · net restant <strong>{formatDA(Math.round((focusTtc - focusTotal) * 100) / 100)}</strong>
        </p>
      ) : null}
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
          {visible.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="text-sm text-muted-foreground">
                Aucun avoir ne correspond à ce filtre.
              </TableCell>
            </TableRow>
          ) : null}
          {visible.map((item) => (
            <TableRow key={item.id} className={item.annule ? "opacity-60" : undefined}>
              <TableCell className="whitespace-nowrap font-medium">
                {item.num}
                {item.annule ? <Badge variant="muted" className="ml-2">annulé</Badge> : null}
              </TableCell>
              <TableCell className="whitespace-nowrap tabular-nums">{formatDate(item.date)}</TableCell>
              <TableCell>{item.clientLabel}</TableCell>
              <TableCell className="whitespace-nowrap">
                {item.origineId ? (
                  <Link href={`/facturation/${item.origineId}`} className="font-medium underline">
                    {item.origineNum}
                  </Link>
                ) : (
                  item.origineNum
                )}
              </TableCell>
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
