"use client";

import { useState, type FormEvent } from "react";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import type { MarkPaidInput } from "@/features/invoices/schemas";
import { MODE_LABELS, PAYMENT_MODE_KEYS, type InvoiceDTO, type PaymentModeKey } from "@/features/invoices/types";
import { formatDA } from "@/utils/format";

/** Propriétés de la fenêtre de règlement. */
export interface MarkPaidDialogProps {
  invoice: InvoiceDTO;
  today: string;
  /** Enregistre le règlement ; renvoie un message d'erreur ou `null` si tout s'est bien passé. */
  onConfirm: (input: MarkPaidInput) => Promise<string | null>;
  triggerLabel?: string;
  /** Bouton réduit à l'icône sur les écrans moyens (tableaux). */
  compact?: boolean;
}

function isPaymentMode(value: string): value is PaymentModeKey {
  return (PAYMENT_MODE_KEYS as readonly string[]).includes(value);
}

/** Fenêtre « Marquer réglé » : date, mode, référence (chèque, virement) et banque. */
export function MarkPaidDialog({ invoice, today, onConfirm, triggerLabel = "Régler", compact = false }: Readonly<MarkPaidDialogProps>): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const idPrefix = `paid-${invoice.id}`;

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const mode = String(form.get("mode") ?? "");
    if (!isPaymentMode(mode)) {
      setError("Choisissez le mode de règlement.");
      return;
    }
    setPending(true);
    setError(null);
    setOpen(false);
    const message = await onConfirm({
      id: invoice.id,
      date: String(form.get("date") ?? ""),
      mode,
      reference: String(form.get("reference") ?? ""),
      banque: String(form.get("banque") ?? ""),
    });
    setPending(false);
    if (message) {
      setError(message);
      setOpen(true);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="success" disabled={pending} aria-label={`${triggerLabel} : ${invoice.tiers}`} title={triggerLabel}>
          <CheckCircle2 />
          <span className={compact ? "hidden 2xl:inline" : undefined}>{triggerLabel}</span>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Enregistrer le règlement</DialogTitle>
          <DialogDescription>
            {invoice.tiers}
            {invoice.numero ? ` · ${invoice.numero}` : ""} · {formatDA(invoice.montant)}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field id={`${idPrefix}-date`} label="Date de règlement">
            <Input id={`${idPrefix}-date`} name="date" type="date" required defaultValue={today} />
          </Field>
          <Field id={`${idPrefix}-mode`} label="Mode">
            <NativeSelect id={`${idPrefix}-mode`} name="mode" defaultValue={invoice.mode ?? "VIREMENT"}>
              {PAYMENT_MODE_KEYS.map((mode) => (
                <option key={mode} value={mode}>
                  {MODE_LABELS[mode]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id={`${idPrefix}-ref`} label="N° de chèque / référence">
            <Input id={`${idPrefix}-ref`} name="reference" defaultValue={invoice.cheque} maxLength={80} />
          </Field>
          <Field id={`${idPrefix}-bank`} label="Banque">
            <Input id={`${idPrefix}-bank`} name="banque" defaultValue={invoice.banque} maxLength={80} />
          </Field>
          {error ? (
            <p role="alert" className="text-sm font-medium text-destructive sm:col-span-2">
              {error}
            </p>
          ) : null}
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Annuler
            </Button>
            <Button type="submit" variant="success" disabled={pending}>
              Confirmer le règlement
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
