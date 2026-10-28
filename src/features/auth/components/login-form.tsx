"use client";

import { useActionState, useState } from "react";
import { LogIn } from "lucide-react";
import { loginAction } from "@/app/actions/auth-actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

/** Formulaire de connexion (server action ; l'adresse saisie est conservée après une erreur). */
export function LoginForm(): React.JSX.Element {
  const [state, formAction, pending] = useActionState(loginAction, null);
  // Champ contrôlé : React réinitialise le formulaire après chaque envoi, l'adresse doit rester saisie.
  const [email, setEmail] = useState("");
  const error = state && !state.success ? state.error : null;
  return (
    <form action={formAction} className="flex flex-col gap-4">
      <Field id="email" label="Adresse e-mail">
        <Input id="email" name="email" type="email" autoComplete="username" required autoFocus value={email} onChange={(event) => setEmail(event.target.value)} />
      </Field>
      <Field id="password" label="Mot de passe">
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </Field>
      {error ? (
        <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}
      <Button type="submit" size="lg" disabled={pending}>
        <LogIn />
        {pending ? "Connexion…" : "Se connecter"}
      </Button>
    </form>
  );
}
