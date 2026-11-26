"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { Printer } from "lucide-react";
import { printableRequestsAction } from "@/app/actions/payment-request-actions";
import { Notice } from "@/components/common/notice";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { filterPrintable, PRINT_MAX, printHref, selectedTotal, toggleVisible } from "@/features/payment-requests/lib/print-selection";
import type { DpPrintableDTO } from "@/features/payment-requests/types";
import { cn } from "@/utils/cn";
import { formatDA, formatDate } from "@/utils/format";

type Filtre = "non_payee" | "a_valider" | "toutes";

const FILTRES: ReadonlyArray<{ value: Filtre; label: string }> = [
  { value: "non_payee", label: "Non payées" },
  { value: "a_valider", label: "À valider" },
  { value: "toutes", label: "Toutes" },
];

/** Bouton « Impression multiple » : choix de plusieurs demandes de paiement en attente, puis impression en une fois. */
export function DpPrintPicker(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [filtre, setFiltre] = useState<Filtre>("non_payee");
  const [items, setItems] = useState<DpPrintableDTO[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    setError(null);
    startTransition(async () => {
      const result = await printableRequestsAction({ filtre });
      if (result.success) {
        setItems(result.data);
      } else setError(result.error);
    });
  }, [open, filtre]);

  const visible = filterPrintable(items, search);
  const allVisibleChecked = visible.length > 0 && visible.every((item) => selected.has(item.id));
  const total = selectedTotal(items, selected);

  function toggle(id: string): void {
    setNotice(null);
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else if (next.size < PRINT_MAX) next.add(id);
      else setNotice(`Une impression ne dépasse pas ${PRINT_MAX} demandes.`);
      return next;
    });
  }

  function toggleAll(): void {
    const { next, truncated } = toggleVisible(selected, visible, !allVisibleChecked);
    setSelected(next);
    setNotice(truncated ? `Sélection limitée à ${PRINT_MAX} demandes par impression.` : null);
  }

  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        <Printer />
        Impression multiple
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Impression multiple des demandes de paiement</DialogTitle>
            <DialogDescription>Cochez les demandes à imprimer : elles sortent ensemble, une page par demande.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap items-center gap-2">
            {FILTRES.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  setFiltre(option.value);
                  setSelected(new Set());
                  setNotice(null);
                }}
                className={buttonVariants({ size: "sm", variant: filtre === option.value ? "default" : "outline" })}
              >
                {option.label}
              </button>
            ))}
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Bénéficiaire, n°, montant…" aria-label="Rechercher une demande" className="min-w-48 flex-1" />
          </div>
          {error ? <Notice tone="error">{error}</Notice> : null}
          {notice ? <Notice tone="warning">{notice}</Notice> : null}
          {pending && items.length === 0 ? <p className="text-sm text-muted-foreground">Chargement des demandes…</p> : null}
          {!pending && !error && items.length === 0 ? <p className="text-sm text-muted-foreground">Aucune demande dans cette catégorie.</p> : null}
          {items.length > 0 ? (
            <div className="rounded-lg border">
              <label className="flex cursor-pointer items-center gap-3 border-b bg-muted/40 p-2 text-sm font-medium">
                <input type="checkbox" className="size-4 cursor-pointer accent-primary" checked={allVisibleChecked} onChange={toggleAll} aria-label="Tout sélectionner" />
                Tout sélectionner ({visible.length})
              </label>
              <ul className="max-h-[45vh] divide-y overflow-y-auto">
                {visible.map((item) => (
                  <li key={item.id}>
                    <label className={cn("flex cursor-pointer items-center gap-3 p-2 text-sm hover:bg-primary/5", selected.has(item.id) && "bg-primary/10")}>
                      <input type="checkbox" className="size-4 shrink-0 cursor-pointer accent-primary" checked={selected.has(item.id)} onChange={() => toggle(item.id)} aria-label={`Sélectionner ${item.ref}`} />
                      <span className="w-28 shrink-0 font-semibold">
                        {item.ref}
                        {item.date ? <span className="block text-xs font-normal text-muted-foreground">{formatDate(item.date)}</span> : null}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-medium">
                        {item.beneficiaire || "—"}
                        <span className="block truncate text-xs font-normal text-muted-foreground">{item.produit}</span>
                      </span>
                      {item.status === "a_valider" ? <Badge variant="warning">À valider</Badge> : null}
                      <Badge variant={item.paymentState === "payee" ? "success" : item.paymentState === "non_reliee" ? "muted" : "warning"}>{item.paymentLabel}</Badge>
                      <span className="w-32 shrink-0 text-right font-medium tabular-nums">{formatDA(item.montant)}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <DialogFooter className="items-center sm:justify-between">
            <p className="text-sm font-medium">
              {selected.size} demande(s) cochée(s) · {formatDA(total)}
            </p>
            <div className="flex gap-2">
              {selected.size > 0 ? (
                <Button type="button" variant="ghost" onClick={() => setSelected(new Set())}>
                  Tout décocher
                </Button>
              ) : null}
              {selected.size > 0 ? (
                <Link href={printHref(items, selected)} target="_blank" className={buttonVariants({})}>
                  <Printer />
                  Imprimer ({selected.size})
                </Link>
              ) : (
                <Button type="button" disabled>
                  <Printer />
                  Imprimer (0)
                </Button>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
