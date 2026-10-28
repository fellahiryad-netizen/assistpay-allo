"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Pencil, Plus } from "lucide-react";
import { saveRibAction } from "@/app/actions/transfer-actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ribValid } from "@/features/transfers/services/rib";
import type { ProviderRibDTO } from "@/features/transfers/types";

/** Ajout ou modification d'un compte du référentiel RIB. */
export function RibFormDialog({ rib }: Readonly<{ rib?: ProviderRibDTO }>): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [value, setValue] = useState(rib?.rib ?? "");
  const [pending, startTransition] = useTransition();

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const types = (["A", "B"] as const).filter((type) => form.get(`type-${type}`) === "on");
    startTransition(async () => {
      const result = await saveRibAction({
        id: rib?.id,
        rib: value,
        noms: String(form.get("noms") ?? "").split("\n").map((name) => name.trim()).filter(Boolean),
        types,
        wilaya: String(form.get("wilaya") ?? ""),
        code: String(form.get("code") ?? ""),
      });
      if (result.success) setOpen(false);
      else setError(result.error);
    });
  }

  const digits = value.replace(/\D/g, "");
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {rib ? (
        <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
          <Pencil className="size-3" />
          Modifier
        </button>
      ) : (
        <Button type="button" onClick={() => setOpen(true)}>
          <Plus />
          Ajouter un RIB
        </Button>
      )}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{rib ? "Modifier le compte" : "Nouveau compte prestataire"}</DialogTitle>
          <DialogDescription>Un changement de RIB saisi par un non-administrateur reste « à valider ».</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field id="rib-value" label="RIB (20 chiffres)" className="sm:col-span-2" hint={digits.length === 20 ? (ribValid(digits) ? "Clé correcte" : "Clé incorrecte") : `${digits.length} / 20 chiffres`}>
            <Input id="rib-value" value={value} onChange={(event) => setValue(event.target.value)} inputMode="numeric" className="font-mono" required />
          </Field>
          <Field id="rib-noms" label="Nom(s) du prestataire (un par ligne)" className="sm:col-span-2">
            <textarea id="rib-noms" name="noms" rows={2} defaultValue={rib?.noms.join("\n") ?? ""} className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm" required />
          </Field>
          <Field id="rib-wilaya" label="Wilaya / adresse">
            <Input id="rib-wilaya" name="wilaya" defaultValue={rib?.wilaya ?? ""} />
          </Field>
          <Field id="rib-code" label="Code prestataire">
            <Input id="rib-code" name="code" defaultValue={rib?.code ?? ""} />
          </Field>
          <fieldset className="flex gap-4 text-sm sm:col-span-2">
            <legend className="mb-1 font-medium">Produits</legend>
            <label className="flex items-center gap-2">
              <Checkbox name="type-A" defaultChecked={rib ? rib.types.includes("A") : true} />
              Assistance routière
            </label>
            <label className="flex items-center gap-2">
              <Checkbox name="type-B" defaultChecked={rib?.types.includes("B") ?? false} />
              BDG
            </label>
          </fieldset>
          {error ? (
            <p role="alert" className="text-sm font-medium text-destructive sm:col-span-2">
              {error}
            </p>
          ) : null}
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={pending}>
              Enregistrer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
