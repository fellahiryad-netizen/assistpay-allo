"use client";

import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { Shuffle } from "lucide-react";
import { changeProviderActivityAction } from "@/app/actions/provider-actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { NativeSelect } from "@/components/ui/native-select";
import { ACTIVITIES, ACTIVITY_LABELS, parseActivity, type Activity } from "@/features/invoices/lib/activity";

/** Propriétés de la fenêtre « Changer l'activité ». */
export interface ChangeActivityDialogProps {
  tiers: string;
  /** Activité d'origine (celle de la section où figure le prestataire). */
  from: Activity;
  /** Nombre de factures impayées concernées (celles du tableau, année du filtre comprise). */
  count: number;
  /** Année du filtre affiché, s'il y en a un. */
  year?: number;
}

/** Fenêtre de confirmation : déplace les factures impayées d'un prestataire d'une activité vers une autre. */
export function ChangeActivityDialog({ tiers, from, count, year }: Readonly<ChangeActivityDialogProps>): React.JSX.Element {
  const router = useRouter();
  const targets = ACTIVITIES.filter((activity) => activity !== from);
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<Activity>(targets[0] ?? "autre");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const id = useId();

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    setError(null);
    const result = await changeProviderActivityAction({ tiers, from, to: target, year, expected: count });
    setPending(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    setOpen(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="ghost" aria-label={`Changer l'activité : ${tiers}`} title="Changer l'activité">
          <Shuffle />
          <span className="hidden 2xl:inline">Activité</span>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Changer l&apos;activité</DialogTitle>
          <DialogDescription>{tiers}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="grid gap-3">
          <p className="text-sm">
            <strong>{count} facture(s) impayée(s)</strong> de ce prestataire, actuellement classées en <strong>{ACTIVITY_LABELS[from]}</strong>
            {year ? ` (année ${year})` : ""}, vont changer d&apos;activité. Les factures déjà réglées ne sont pas touchées.
          </p>
          <Field id={`${id}-to`} label="Nouvelle activité">
            <NativeSelect id={`${id}-to`} value={target} onChange={(event) => setTarget(parseActivity(event.target.value) ?? target)}>
              {targets.map((activity) => (
                <option key={activity} value={activity}>
                  {ACTIVITY_LABELS[activity]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          {error ? (
            <p role="alert" className="text-sm font-medium text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Modification…" : `Confirmer (${count} facture(s))`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
