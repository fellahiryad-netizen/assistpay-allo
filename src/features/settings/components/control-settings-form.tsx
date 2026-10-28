"use client";

import { useState, useTransition, type FormEvent } from "react";
import { saveControlSettingsAction } from "@/app/actions/settings-actions";
import { Notice } from "@/components/common/notice";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { ControlSettings } from "@/features/settings/services/settings-service";

/** Formulaire des paramètres de contrôle (lecture seule hors administrateur). */
export function ControlSettingsForm({ initial, canEdit }: Readonly<{ initial: ControlSettings; canEdit: boolean }>): React.JSX.Element {
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await saveControlSettingsAction({ seuil: Number(form.get("seuil")), articleImposition: String(form.get("ai") ?? "") });
      setMessage(result.success ? { tone: "success", text: "Paramètres enregistrés." } : { tone: "error", text: result.error });
    });
  }

  return (
    <form onSubmit={submit} className="flex max-w-xl flex-col gap-3">
      <Field id="set-seuil" label="Seuil de double validation : cumul mensuel viré à un même prestataire (DA)">
        <Input id="set-seuil" name="seuil" type="number" step={100000} min={100000} defaultValue={initial.seuil} disabled={!canEdit} required />
      </Field>
      <Field id="set-ai" label="N° d'article d'imposition d'EURL Allo Assistance (mention des factures)">
        <Input id="set-ai" name="ai" defaultValue={initial.articleImposition} disabled={!canEdit} maxLength={60} />
      </Field>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      {canEdit ? (
        <div>
          <Button type="submit" disabled={pending}>
            {pending ? "Enregistrement…" : "Enregistrer les paramètres"}
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Réservé aux administrateurs.</p>
      )}
    </form>
  );
}
