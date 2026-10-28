"use client";

import { useEffect, useState, useTransition } from "react";
import { Search } from "lucide-react";
import { requestInvoiceOptionsAction } from "@/app/actions/payment-request-actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { DpInvoiceOption } from "@/features/payment-requests/types";
import { round2 } from "@/utils/amounts";
import { formatDA } from "@/utils/format";

/** Propriétés du sélecteur de factures fournisseurs. */
export interface InvoicePickerDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  initial?: string[];
  onOpenChange: (open: boolean) => void;
  /** Renvoie un message d'erreur, ou `null` si tout s'est bien passé. */
  onConfirm: (invoiceIds: string[]) => Promise<string | null>;
}

/** Recherche et sélection de factures fournisseurs en attente. */
export function InvoicePickerDialog({ open, title, description, confirmLabel, initial = [], onOpenChange, onConfirm }: Readonly<InvoicePickerDialogProps>): React.JSX.Element {
  const [search, setSearch] = useState("");
  const [options, setOptions] = useState<DpInvoiceOption[]>([]);
  const [selected, setSelected] = useState<Map<string, DpInvoiceOption>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    setSelected(new Map());
    const timer = setTimeout(() => {
      startTransition(async () => {
        const result = await requestInvoiceOptionsAction(search);
        if (result.success) {
          setOptions(result.data);
          setSelected((current) => {
            if (current.size || !initial.length) return current;
            return new Map(result.data.filter((option) => initial.includes(option.id)).map((option) => [option.id, option]));
          });
        } else setError(result.error);
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [search, open]);

  const total = round2([...selected.values()].reduce((sum, option) => sum + option.montant, 0));

  function confirm(): void {
    setError(null);
    startTransition(async () => {
      const message = await onConfirm([...selected.keys()]);
      if (message) setError(message);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Prestataire, n° de facture, catégorie…" className="pl-9" aria-label="Rechercher une facture" />
        </div>
        <ul className="max-h-80 divide-y overflow-y-auto rounded-md border">
          {options.length === 0 ? (
            <li className="p-6 text-center text-sm text-muted-foreground">{pending ? "Recherche…" : "Aucune facture fournisseur en attente ne correspond."}</li>
          ) : (
            options.map((option) => (
              <li key={option.id}>
                <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-muted/40">
                  <Checkbox
                    checked={selected.has(option.id)}
                    onChange={(event) =>
                      setSelected((current) => {
                        const next = new Map(current);
                        if (event.target.checked) next.set(option.id, option);
                        else next.delete(option.id);
                        return next;
                      })
                    }
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{option.label}</span>
                    {option.linkedRef ? <span className="block text-xs text-warning">déjà dans la demande {option.linkedRef}</span> : null}
                  </span>
                  <b className="tabular-nums">{formatDA(option.montant)}</b>
                </label>
              </li>
            ))
          )}
        </ul>
        <p className="text-sm">
          {selected.size} facture(s) sélectionnée(s) · <b className="tabular-nums">{formatDA(total)}</b>
        </p>
        {error ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button type="button" onClick={confirm} disabled={pending}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
