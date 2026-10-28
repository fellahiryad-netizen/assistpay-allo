"use client";

import { useState, useTransition, type FormEvent } from "react";
import { changePasswordAction } from "@/app/actions/auth-actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { changePasswordSchema } from "@/features/auth/schemas";

/** Changement de son propre mot de passe. */
export function ChangePasswordForm(): React.JSX.Element {
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const parsed = changePasswordSchema.safeParse({ current: data.get("current"), next: data.get("next"), confirm: data.get("confirm") });
    if (!parsed.success) {
      setMessage({ kind: "error", text: parsed.error.issues[0]?.message ?? "Formulaire incomplet." });
      return;
    }
    startTransition(async () => {
      const result = await changePasswordAction(parsed.data);
      if (result.success) {
        form.reset();
        setMessage({ kind: "ok", text: "Votre mot de passe a été modifié." });
      } else {
        setMessage({ kind: "error", text: result.error });
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex max-w-md flex-col gap-4" noValidate>
      <Field id="pw-current" label="Mot de passe actuel">
        <Input id="pw-current" name="current" type="password" autoComplete="current-password" required />
      </Field>
      <Field id="pw-next" label="Nouveau mot de passe" hint="10 caractères minimum">
        <Input id="pw-next" name="next" type="password" autoComplete="new-password" minLength={10} required />
      </Field>
      <Field id="pw-confirm" label="Confirmer le nouveau mot de passe">
        <Input id="pw-confirm" name="confirm" type="password" autoComplete="new-password" required />
      </Field>
      {message ? (
        <p role="status" className={message.kind === "ok" ? "text-sm font-medium text-success" : "text-sm font-medium text-destructive"}>
          {message.text}
        </p>
      ) : null}
      <div>
        <Button type="submit" disabled={pending}>
          Changer le mot de passe
        </Button>
      </div>
    </form>
  );
}
