"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Briefcase, CheckCircle2, Trash2, X } from "lucide-react";
import { deleteInvoicesBulkAction, markInvoicesPaidBulkAction, transferToHrAction, type BulkReport } from "@/app/actions/invoice-actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { MODE_LABELS, PAYMENT_MODE_KEYS, type PaymentModeKey } from "@/features/invoices/types";
import { formatDA } from "@/utils/format";

/** Propriétés de la barre d'actions de masse. */
export interface InvoiceBulkBarProps {
  /** Identifiants cochés. */
  ids: string[];
  /** Parmi eux, ceux qui peuvent être réglés (en attente). */
  payableIds: string[];
  /** Total des montants cochés. */
  total: number;
  today: string;
  /** Seuls les administrateurs peuvent transférer des lignes de paie vers l'onglet RH. */
  isAdmin?: boolean;
  onClear: () => void;
}

function isPaymentMode(value: string): value is PaymentModeKey {
  return (PAYMENT_MODE_KEYS as readonly string[]).includes(value);
}

function summary(report: BulkReport, verb: string): string {
  const parts: string[] = [];
  if (report.done) parts.push(`${report.done} facture(s) ${verb}`);
  if (report.pending) parts.push(`${report.pending} demande(s) de suppression envoyée(s) à l'administrateur`);
  if (report.failures.length) parts.push(`${report.failures.length} refusée(s) : ${[...new Set(report.failures)].join(" / ")}`);
  return parts.join(". ") + ".";
}

/** Barre fixe affichée quand des factures sont cochées : règlement groupé ou suppression groupée. */
export function InvoiceBulkBar({ ids, payableIds, total, today, isAdmin = false, onClear }: Readonly<InvoiceBulkBarProps>): React.JSX.Element {
  const [dialog, setDialog] = useState<"paid" | "delete" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submitPaid(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const mode = String(form.get("mode") ?? "");
    if (!isPaymentMode(mode)) {
      setError("Choisissez le mode de règlement.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await markInvoicesPaidBulkAction({ ids: payableIds, date: String(form.get("date") ?? ""), mode, reference: String(form.get("reference") ?? ""), banque: String(form.get("banque") ?? "") });
      if (!result.success) return setError(result.error);
      setDialog(null);
      setMessage(summary(result.data, "réglée(s)"));
      onClear();
    });
  }

  function transferHr(): void {
    if (!window.confirm(`Transférer ${ids.length} ligne(s) vers l'onglet RH ? Les factures d'origine seront remplacées par les écritures RH.`)) return;
    setError(null);
    startTransition(async () => {
      const result = await transferToHrAction({ ids });
      if (!result.success) return setMessage(result.error);
      const { done, failures } = result.data;
      setMessage([done ? `${done} ligne(s) transférée(s) vers RH` : "", failures.length ? `${failures.length} refusée(s) : ${failures.join(" / ")}` : ""].filter(Boolean).join(". ") + ".");
      onClear();
    });
  }

  function submitDelete(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError(null);
    startTransition(async () => {
      const result = await deleteInvoicesBulkAction({ ids, motif: String(form.get("motif") ?? "") });
      if (!result.success) return setError(result.error);
      setDialog(null);
      setMessage(summary(result.data, "supprimée(s)"));
      onClear();
    });
  }

  return (
    <>
      {message ? (
        <p role="status" className="mb-3 rounded-md border bg-card p-3 text-sm font-medium">
          {message}
        </p>
      ) : null}
      {ids.length > 0 ? (
        <div className="sticky bottom-3 z-20 mb-3 flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3 shadow-lg">
          <p className="mr-auto text-sm font-medium">
            {ids.length} facture(s) sélectionnée(s) · {formatDA(total)}
          </p>
          <Button type="button" size="sm" variant="success" disabled={payableIds.length === 0 || pending} onClick={() => { setError(null); setDialog("paid"); }}>
            <CheckCircle2 />
            Marquer réglées ({payableIds.length})
          </Button>
          {isAdmin ? (
            <Button type="button" size="sm" variant="outline" disabled={pending} onClick={transferHr}>
              <Briefcase />
              Transférer vers RH
            </Button>
          ) : null}
          <Button type="button" size="sm" variant="destructive" disabled={pending} onClick={() => { setError(null); setDialog("delete"); }}>
            <Trash2 />
            Supprimer ({ids.length})
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={onClear}>
            <X />
            Tout décocher
          </Button>
        </div>
      ) : null}

      <Dialog open={dialog === "paid"} onOpenChange={(open) => setDialog(open ? "paid" : null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Régler {payableIds.length} facture(s)</DialogTitle>
            <DialogDescription>La même date, le même mode et la même référence seront appliqués à toutes les factures en attente de la sélection.</DialogDescription>
          </DialogHeader>
          <form onSubmit={submitPaid} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field id="bulk-date" label="Date de règlement">
              <Input id="bulk-date" name="date" type="date" required defaultValue={today} />
            </Field>
            <Field id="bulk-mode" label="Mode de règlement">
              <NativeSelect id="bulk-mode" name="mode" defaultValue="VIREMENT">
                {PAYMENT_MODE_KEYS.map((mode) => (
                  <option key={mode} value={mode}>
                    {MODE_LABELS[mode]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field id="bulk-ref" label="Référence (facultatif)">
              <Input id="bulk-ref" name="reference" maxLength={80} />
            </Field>
            <Field id="bulk-bank" label="Banque (facultatif)">
              <Input id="bulk-bank" name="banque" maxLength={80} />
            </Field>
            {error ? (
              <p role="alert" className="text-sm font-medium text-destructive sm:col-span-2">
                {error}
              </p>
            ) : null}
            <DialogFooter className="sm:col-span-2">
              <Button type="submit" variant="success" disabled={pending}>
                {pending ? "Enregistrement…" : "Confirmer le règlement"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "delete"} onOpenChange={(open) => setDialog(open ? "delete" : null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Supprimer {ids.length} facture(s) ?</DialogTitle>
            <DialogDescription>Les factures déjà réglées seront refusées : remettez-les d'abord en attente. Pour un utilisateur non administrateur, chaque suppression est envoyée en demande à l'administrateur.</DialogDescription>
          </DialogHeader>
          <form onSubmit={submitDelete} className="flex flex-col gap-3">
            <Field id="bulk-motif" label="Motif (facultatif)">
              <Input id="bulk-motif" name="motif" maxLength={300} />
            </Field>
            {error ? (
              <p role="alert" className="text-sm font-medium text-destructive">
                {error}
              </p>
            ) : null}
            <DialogFooter>
              <Button type="submit" variant="destructive" disabled={pending}>
                {pending ? "Suppression…" : "Confirmer la suppression"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
