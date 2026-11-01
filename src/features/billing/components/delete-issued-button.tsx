"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { requestDeletionAction } from "@/app/actions/deletion-actions";
import { Button } from "@/components/ui/button";

/** Supprime une facture établie après confirmation et motif. */
export function DeleteIssuedButton({ id, num, direct }: Readonly<{ id: string; num: string; direct: boolean }>): React.JSX.Element {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function remove(): void {
    const motif = window.prompt(direct ? `Supprimer la facture ${num} ? Cette action est définitive.\n\nMotif de la suppression :` : `La suppression de la facture ${num} sera soumise à la validation d'un administrateur.\n\nMotif de la demande :`);
    if (motif === null) return;
    setError(null);
    startTransition(async () => {
      const result = await requestDeletionAction({ kind: "etablie", id, motif });
      if (!result.success) setError(result.error);
      else if (result.data.done) router.push("/facturation");
      else setNotice("Demande envoyée : un administrateur doit la valider.");
    });
  }

  return (
    <>
      <Button type="button" variant="outline" disabled={pending} onClick={remove} className="text-destructive">
        <Trash2 />
        {direct ? "Supprimer" : "Demander la suppression"}
      </Button>
      {notice ? <p className="w-full text-sm font-medium text-success">{notice}</p> : null}
      {error ? (
        <p role="alert" className="w-full text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </>
  );
}
