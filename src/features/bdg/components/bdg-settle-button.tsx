"use client";

import { useState, useTransition, type FormEvent } from "react";
import { settleBdgPartAction } from "@/app/actions/bdg-actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { formatDA } from "@/utils/format";

/** Propriétés du bouton de règlement BDG. */
export interface BdgSettleButtonProps {
  id: string;
  part: "debours" | "frais" | "tout";
  amount: number;
  label: string;
  today: string;
}

/** Règlement des débours, des frais ou de toute la facture BDG. */
export function BdgSettleButton({ id, part, amount, label, today }: Readonly<BdgSettleButtonProps>): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const mode = String(form.get("mode"));
    startTransition(async () => {
      const result = await settleBdgPartAction({
        id,
        part,
        date: String(form.get("date")),
        mode: mode === "CHEQUE" || mode === "VERSEMENT" || mode === "AUTRE" ? mode : "VIREMENT",
        reference: String(form.get("reference") ?? ""),
      });
      if (result.success) setOpen(false);
      else setError(result.error);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button type="button" size="sm" variant="success" onClick={() => setOpen(true)}>
        {label}
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
          <DialogDescription>{formatDA(amount)}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field id={`bdg-d-${id}-${part}`} label="Date">
            <Input id={`bdg-d-${id}-${part}`} name="date" type="date" defaultValue={today} required />
          </Field>
          <Field id={`bdg-m-${id}-${part}`} label="Mode">
            <NativeSelect id={`bdg-m-${id}-${part}`} name="mode" defaultValue="VIREMENT">
              <option value="VIREMENT">Virement</option>
              <option value="CHEQUE">Chèque</option>
              <option value="VERSEMENT">Versement</option>
            </NativeSelect>
          </Field>
          <Field id={`bdg-r-${id}-${part}`} label="Référence">
            <Input id={`bdg-r-${id}-${part}`} name="reference" />
          </Field>
          {error ? (
            <p role="alert" className="text-sm font-medium text-destructive sm:col-span-3">
              {error}
            </p>
          ) : null}
          <DialogFooter className="sm:col-span-3">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Annuler
            </Button>
            <Button type="submit" variant="success" disabled={pending}>
              Confirmer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
