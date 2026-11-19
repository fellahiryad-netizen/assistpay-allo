"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { deleteHrEntryAction, saveHrEntryAction } from "@/app/actions/hr-actions";
import { Notice } from "@/components/common/notice";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { isProbableDuplicateMessage } from "@/features/hr/lib/hr-duplicates";
import { HR_NATURES, type HrEntryDTO } from "@/features/hr/types";
import { parseLooseAmount } from "@/utils/amounts";

/** Propriétés de la fenêtre de saisie RH. */
export interface HrEntryDialogProps {
  entry?: HrEntryDTO;
  beneficiaries: string[];
  today: string;
  /** Texte du bouton d'ouverture d'une écriture existante (« Modifier » par défaut). */
  triggerLabel?: string;
}

/** Nouvelle saisie ou modification d'une écriture RH (salaire, CNAS, G50, avance…). */
export function HrEntryDialog({ entry, beneficiaries, today, triggerLabel = "Modifier" }: Readonly<HrEntryDialogProps>): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState(entry?.mode ?? "VIRMT");
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [probableDuplicate, setProbableDuplicate] = useState(false);
  const [confirmDuplicate, setConfirmDuplicate] = useState(false);
  const [pending, startTransition] = useTransition();
  const listId = `rh-benef-${entry?.id ?? "new"}`;

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    const amount = parseLooseAmount(String(form.get("montant") ?? ""));
    startTransition(async () => {
      const result = await saveHrEntryAction({
        id: entry?.id,
        nature: String(form.get("nature")) as (typeof HR_NATURES)[number],
        sens: form.get("sens") === "RETOUR" ? "RETOUR" : "PAIEMENT",
        beneficiaire: String(form.get("beneficiaire") ?? ""),
        mois: String(form.get("mois") ?? ""),
        date: String(form.get("date") ?? ""),
        montant: amount,
        mode: mode === "CHEQUE" ? "CHEQUE" : mode === "VIRMT" ? "VIRMT" : "",
        cheque: String(form.get("cheque") ?? ""),
        banque: String(form.get("banque") ?? ""),
        libelle: String(form.get("libelle") ?? ""),
        confirmerDoublon: probableDuplicate && confirmDuplicate,
      });
      if (result.success) setOpen(false);
      else {
        setError(result.error);
        // La case n'apparaît qu'après un refus « doublon probable » ; un doublon certain ne se confirme jamais.
        setConfirmDuplicate(false);
        setProbableDuplicate(result.code === "CONFLICT" && isProbableDuplicateMessage(result.error));
      }
    });
  }

  /** Toute modification d'un champ annule la confirmation du doublon : elle ne vaut que pour la saisie qui a été refusée. */
  function resetConfirmation(event: FormEvent<HTMLFormElement>): void {
    if (event.target instanceof HTMLInputElement && event.target.name === "confirmerDoublon") return;
    setConfirmDuplicate(false);
  }

  function remove(): void {
    if (!entry) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    startTransition(async () => {
      const result = await deleteHrEntryAction({ id: entry.id });
      if (result.success) setOpen(false);
      else setError(result.error);
    });
  }

  const show = (): void => {
    setError(null);
    setConfirmDelete(false);
    setProbableDuplicate(false);
    setConfirmDuplicate(false);
    setOpen(true);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {entry ? (
        <button type="button" onClick={show} className="text-xs font-medium text-primary hover:underline">
          {triggerLabel}
        </button>
      ) : (
        <Button type="button" onClick={show}>
          <Plus />
          Nouvelle saisie RH
        </Button>
      )}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{entry ? "Modifier la saisie RH" : "Nouvelle saisie RH"}</DialogTitle>
          <DialogDescription>Le total du mois est reporté automatiquement dans le suivi (Charges de personnel, agrégé).</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} onChange={resetConfirmation} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field id="rh-nature" label="Nature">
            <NativeSelect id="rh-nature" name="nature" defaultValue={entry?.nature ?? "Salaire"}>
              {HR_NATURES.map((nature) => (
                <option key={nature}>{nature}</option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="rh-sens" label="Type">
            <NativeSelect id="rh-sens" name="sens" defaultValue={entry?.sens ?? "PAIEMENT"}>
              <option value="PAIEMENT">Paiement</option>
              <option value="RETOUR">Retour / remboursement</option>
            </NativeSelect>
          </Field>
          <Field id="rh-benef" label="Employé / organisme" className="sm:col-span-2">
            <Input id="rh-benef" name="beneficiaire" list={listId} defaultValue={entry?.beneficiaire ?? ""} required maxLength={160} />
            <datalist id={listId}>
              {beneficiaries.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </Field>
          <Field id="rh-mois" label="Mois concerné">
            <Input id="rh-mois" name="mois" type="month" defaultValue={entry?.mois || today.slice(0, 7)} required />
          </Field>
          <Field id="rh-date" label="Date de paiement">
            <Input id="rh-date" name="date" type="date" defaultValue={entry ? (entry.date ?? "") : today} />
          </Field>
          <Field id="rh-montant" label="Montant (DA)">
            <Input id="rh-montant" name="montant" inputMode="decimal" defaultValue={entry ? String(entry.montant).replace(".", ",") : ""} required />
          </Field>
          <Field id="rh-mode" label="Mode de règlement">
            <NativeSelect id="rh-mode" value={mode} onChange={(event) => setMode(event.target.value)}>
              <option value="VIRMT">Virement</option>
              <option value="CHEQUE">Chèque</option>
              <option value="">Autre</option>
            </NativeSelect>
          </Field>
          {mode === "CHEQUE" ? (
            <Field id="rh-cheque" label="N° de chèque">
              <Input id="rh-cheque" name="cheque" defaultValue={entry?.cheque ?? ""} required maxLength={40} />
            </Field>
          ) : null}
          <Field id="rh-banque" label="Banque">
            <Input id="rh-banque" name="banque" defaultValue={entry?.banque ?? ""} maxLength={60} />
          </Field>
          <Field id="rh-libelle" label="Libellé" className="sm:col-span-2">
            <Input id="rh-libelle" name="libelle" defaultValue={entry?.libelle ?? ""} maxLength={300} />
          </Field>
          {error ? (
            <Notice tone="error" className="sm:col-span-2">
              {error}
            </Notice>
          ) : null}
          {probableDuplicate ? (
            <label className="flex items-start gap-2 text-sm sm:col-span-2">
              <Checkbox name="confirmerDoublon" checked={confirmDuplicate} onChange={(event) => setConfirmDuplicate(event.target.checked)} className="mt-0.5" />
              <span>Ce n'est pas un doublon : enregistrer quand même ce paiement distinct.</span>
            </label>
          ) : null}
          <DialogFooter className="sm:col-span-2">
            {entry ? (
              <Button type="button" variant="destructive" onClick={remove} disabled={pending} className="sm:mr-auto">
                {confirmDelete ? "Confirmer la suppression" : "Supprimer"}
              </Button>
            ) : null}
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Enregistrement…" : "Enregistrer"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
