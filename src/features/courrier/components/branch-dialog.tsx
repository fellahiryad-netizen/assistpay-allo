"use client";

import { useState, useTransition, type FormEvent } from "react";
import { saveBranchAddressAction } from "@/app/actions/courrier-actions";
import { Notice } from "@/components/common/notice";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { fieldErrors } from "@/features/courrier/lib/form-errors";
import { branchSchema, type BranchFormValues } from "@/features/courrier/schemas";
import { COURRIER_COMPANIES, type BranchAddress } from "@/features/courrier/types";

/** Propriétés de la fenêtre de saisie d'une succursale. */
export interface BranchDialogProps {
  /** Fiche à modifier, « new » pour un ajout, null pour fermer la fenêtre. */
  target: BranchAddress | "new" | null;
  /** Compagnie proposée par défaut à l'ajout. */
  defaultCompany: BranchFormValues["compagnie"];
  onClose: () => void;
  onSaved: (message: string) => void;
}

const emptyValues = (company: BranchFormValues["compagnie"]): BranchFormValues => ({ compagnie: company, nom: "", contact: "", telephones: "", adresse: "", remarque: "" });

/** Ajout ou modification d'une succursale destinataire du courrier. */
export function BranchDialog({ target, defaultCompany, onClose, onSaved }: Readonly<BranchDialogProps>): React.JSX.Element {
  return (
    <Dialog open={target !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent>
        {target !== null ? <BranchForm key={target === "new" ? "new" : target.id} target={target} defaultCompany={defaultCompany} onClose={onClose} onSaved={onSaved} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function BranchForm({ target, defaultCompany, onClose, onSaved }: Readonly<Omit<BranchDialogProps, "target"> & { target: BranchAddress | "new" }>): React.JSX.Element {
  const editing = target === "new" ? null : target;
  const [values, setValues] = useState<BranchFormValues>(editing ? { id: editing.id, compagnie: editing.compagnie, nom: editing.nom, contact: editing.contact, telephones: editing.telephones, adresse: editing.adresse, remarque: editing.remarque } : emptyValues(defaultCompany));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const bind = (name: Exclude<keyof BranchFormValues, "id" | "compagnie">) => ({
    id: `br-${name}`,
    name,
    value: values[name] ?? "",
    onChange: (event: React.ChangeEvent<HTMLInputElement>): void => setValues((current) => ({ ...current, [name]: event.target.value })),
    "aria-invalid": errors[name] ? true : undefined,
    "aria-describedby": errors[name] ? `br-${name}-error` : undefined,
    disabled: pending,
  });

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setFailure(null);
    const parsed = branchSchema.safeParse(values);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    setErrors({});
    startTransition(async () => {
      const result = await saveBranchAddressAction(values);
      if (result.success) {
        onSaved(editing ? `La fiche « ${parsed.data.nom} » est modifiée.` : `La fiche « ${parsed.data.nom} » est ajoutée.`);
        onClose();
      } else setFailure(result.error);
    });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{editing ? "Modifier la succursale" : "Ajouter une succursale"}</DialogTitle>
        <DialogDescription>Ces informations servent à l&apos;étiquette collée sur l&apos;enveloppe : écrivez-les comme elles doivent y apparaître.</DialogDescription>
      </DialogHeader>
      <form onSubmit={submit} noValidate className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field id="br-compagnie" label="Compagnie" error={errors.compagnie}>
          <NativeSelect id="br-compagnie" name="compagnie" value={values.compagnie} disabled={pending} onChange={(event) => setValues((current) => ({ ...current, compagnie: event.target.value === "CAAT" ? "CAAT" : "CAAR" }))}>
            {COURRIER_COMPANIES.map((company) => (
              <option key={company}>{company}</option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="br-nom" label="Nom de la succursale" error={errors.nom}>
          <Input {...bind("nom")} placeholder="SUCCURSALE CAAR ORAN 400" autoComplete="off" />
        </Field>
        <Field id="br-adresse" label="Adresse" error={errors.adresse} className="sm:col-span-2">
          <Input {...bind("adresse")} placeholder="CITE ADMINISTRATIVE ILOT 26 ZHUN-USTO ORAN" autoComplete="off" />
        </Field>
        <Field id="br-telephones" label="Téléphone(s)" error={errors.telephones} hint="Plusieurs numéros possibles, séparés par « / ». Facultatif.">
          <Input {...bind("telephones")} placeholder="041 70 68 01 /04 /05" inputMode="tel" autoComplete="off" />
        </Field>
        <Field id="br-contact" label="Nom du contact" error={errors.contact} hint="Facultatif : s'imprime « À l'attention de … ».">
          <Input {...bind("contact")} placeholder="Mr. NOM PRÉNOM" autoComplete="off" />
        </Field>
        <Field id="br-remarque" label="Remarque" error={errors.remarque} className="sm:col-span-2" hint="Facultatif, non imprimée.">
          <Input {...bind("remarque")} autoComplete="off" />
        </Field>
        {failure ? (
          <Notice tone="error" className="sm:col-span-2">
            {failure}
          </Notice>
        ) : null}
        <DialogFooter className="sm:col-span-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            Annuler
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Enregistrement…" : "Enregistrer"}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
