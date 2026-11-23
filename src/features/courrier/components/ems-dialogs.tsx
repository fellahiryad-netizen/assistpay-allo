"use client";

import { useState, useTransition, type FormEvent } from "react";
import { saveEmsContactAction, saveEmsSocieteAction } from "@/app/actions/courrier-actions";
import { Notice } from "@/components/common/notice";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { fieldErrors } from "@/features/courrier/lib/form-errors";
import { emsContactSchema, emsSocieteSchema, type EmsContactFormValues } from "@/features/courrier/schemas";
import { EMS_ROLES, EMS_ROLE_LABELS, type EmsContact } from "@/features/courrier/types";

/** Propriétés de la fenêtre de saisie d'une personne du prestataire de courrier. */
export interface EmsContactDialogProps {
  /** Personne à modifier, « new » pour un ajout, null pour fermer la fenêtre. */
  target: EmsContact | "new" | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}

/** Ajout ou modification d'une personne du prestataire de courrier (ramasseur, réclamations ou remplaçant). */
export function EmsContactDialog({ target, onClose, onSaved }: Readonly<EmsContactDialogProps>): React.JSX.Element {
  return (
    <Dialog open={target !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent>{target !== null ? <EmsContactForm key={target === "new" ? "new" : target.id} target={target} onClose={onClose} onSaved={onSaved} /> : null}</DialogContent>
    </Dialog>
  );
}

function EmsContactForm({ target, onClose, onSaved }: Readonly<Omit<EmsContactDialogProps, "target"> & { target: EmsContact | "new" }>): React.JSX.Element {
  const editing = target === "new" ? null : target;
  const [values, setValues] = useState<EmsContactFormValues>(
    editing ? { id: editing.id, nom: editing.nom, role: editing.role, telephone: editing.telephone, email: editing.email, remarque: editing.remarque } : { nom: "", role: "RAMASSEUR", telephone: "", email: "", remarque: "" },
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const bind = (name: "nom" | "telephone" | "email" | "remarque") => ({
    id: `ems-${name}`,
    name,
    value: values[name] ?? "",
    onChange: (event: React.ChangeEvent<HTMLInputElement>): void => setValues((current) => ({ ...current, [name]: event.target.value })),
    "aria-invalid": errors[name] ? true : undefined,
    "aria-describedby": errors[name] ? `ems-${name}-error` : undefined,
    disabled: pending,
  });

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setFailure(null);
    const parsed = emsContactSchema.safeParse(values);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    setErrors({});
    startTransition(async () => {
      const result = await saveEmsContactAction(values);
      if (result.success) {
        onSaved(editing ? `Le contact « ${parsed.data.nom} » est modifié.` : `Le contact « ${parsed.data.nom} » est ajouté.`);
        onClose();
      } else setFailure(result.error);
    });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{editing ? "Modifier le contact EMS" : "Ajouter un contact EMS"}</DialogTitle>
        <DialogDescription>Personne à joindre chez le prestataire de courrier.</DialogDescription>
      </DialogHeader>
      <form onSubmit={submit} noValidate className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field id="ems-nom" label="Nom" error={errors.nom}>
          <Input {...bind("nom")} placeholder="Hichem" autoComplete="off" />
        </Field>
        <Field id="ems-role" label="Rôle" error={errors.role}>
          <NativeSelect id="ems-role" name="role" value={values.role} disabled={pending} onChange={(event) => setValues((current) => ({ ...current, role: event.target.value === "RECLAMATION" ? "RECLAMATION" : "RAMASSEUR" }))}>
            {EMS_ROLES.map((role) => (
              <option key={role} value={role}>
                {EMS_ROLE_LABELS[role]}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="ems-telephone" label="Téléphone" error={errors.telephone}>
          <Input {...bind("telephone")} placeholder="0697 38 88 81" inputMode="tel" autoComplete="off" />
        </Field>
        <Field id="ems-email" label="E-mail" error={errors.email} hint="Facultatif.">
          <Input {...bind("email")} type="email" placeholder="nom@ems.dz" autoComplete="off" />
        </Field>
        <Field id="ems-remarque" label="Remarque" error={errors.remarque} className="sm:col-span-2" hint="Facultatif.">
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

/** Propriétés de la fenêtre du nom de société. */
export interface EmsSocieteDialogProps {
  open: boolean;
  current: string;
  onClose: () => void;
  onSaved: (message: string) => void;
}

/** Changement du nom de la société de courrier. */
export function EmsSocieteDialog({ open, current, onClose, onSaved }: Readonly<EmsSocieteDialogProps>): React.JSX.Element {
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent>{open ? <EmsSocieteForm current={current} onClose={onClose} onSaved={onSaved} /> : null}</DialogContent>
    </Dialog>
  );
}

function EmsSocieteForm({ current, onClose, onSaved }: Readonly<Omit<EmsSocieteDialogProps, "open">>): React.JSX.Element {
  const [nom, setNom] = useState(current);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const parsed = emsSocieteSchema.safeParse({ nom });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Nom invalide.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await saveEmsSocieteAction({ nom });
      if (result.success) {
        onSaved(`La société de courrier s'appelle maintenant « ${result.data.nom} ».`);
        onClose();
      } else setError(result.error);
    });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Société de courrier</DialogTitle>
        <DialogDescription>Nom de la société qui ramasse le courrier.</DialogDescription>
      </DialogHeader>
      <form onSubmit={submit} noValidate className="flex flex-col gap-3">
        <Field id="ems-societe" label="Nom de la société" error={error ?? undefined}>
          <Input id="ems-societe" value={nom} onChange={(event) => setNom(event.target.value)} disabled={pending} autoComplete="off" aria-invalid={error ? true : undefined} />
        </Field>
        <DialogFooter>
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
