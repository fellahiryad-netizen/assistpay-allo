"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { deleteIssuedAction } from "@/app/actions/billing-actions";
import { Button } from "@/components/ui/button";

/** Supprime une facture établie après confirmation et motif. */
export function DeleteIssuedButton({ id, num }: Readonly<{ id: string; num: string }>): React.JSX.Element {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function remove(): void {
    const motif = window.prompt(`Supprimer la facture ${num} ? Cette action est définitive.\n\nMotif de la suppression :`);
    if (motif === null) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteIssuedAction({ id, motif });
      if (result.success) router.push("/facturation");
      else setError(result.error);
    });
  }

  return (
    <>
      <Button type="button" variant="outline" disabled={pending} onClick={remove} className="text-destructive">
        <Trash2 />
        Supprimer
      </Button>
      {error ? (
        <p role="alert" className="w-full text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </>
  );
}
