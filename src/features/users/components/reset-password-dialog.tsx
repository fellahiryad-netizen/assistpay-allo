"use client";

import { useState, useTransition, type FormEvent } from "react";
import { KeyRound } from "lucide-react";
import { resetUserPasswordAction } from "@/app/actions/user-actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

/** Propriétés de la fenêtre de mot de passe. */
export interface ResetPasswordDialogProps {
  userId: string;
  email: string;
}

/** Définit un nouveau mot de passe pour un compte (à communiquer à la personne). */
export function ResetPasswordDialog({ userId, email }: Readonly<ResetPasswordDialogProps>): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const form = event.currentTarget;
    const password = String(new FormData(form).get("password") ?? "");
    startTransition(async () => {
      const result = await resetUserPasswordAction({ userId, password });
      if (result.success) {
        form.reset();
        setMessage({ kind: "ok", text: "Mot de passe enregistré." });
      } else {
        setMessage({ kind: "error", text: result.error });
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setMessage(null);
      }}
    >
      <DialogTrigger asChild>
        <button type="button" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
          <KeyRound className="size-3" />
          Mot de passe
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nouveau mot de passe</DialogTitle>
          <DialogDescription>{email}</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <Field id={`pw-${userId}`} label="Mot de passe (10 caractères minimum)">
            <Input id={`pw-${userId}`} name="password" type="password" minLength={10} required autoComplete="new-password" />
          </Field>
          {message ? (
            <p role="status" className={message.kind === "ok" ? "text-sm text-success" : "text-sm font-medium text-destructive"}>
              {message.text}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Fermer
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
