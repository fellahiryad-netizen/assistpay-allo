"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { decideDeletionAction } from "@/app/actions/deletion-actions";
import { Button } from "@/components/ui/button";

/** Valide (suppression effective) ou refuse une demande de suppression. */
export function DeletionDecision({ id }: Readonly<{ id: string }>): React.JSX.Element {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function decide(approve: boolean): void {
    const note = approve ? "" : (window.prompt("Motif du refus (facultatif) :") ?? null);
    if (note === null) return;
    if (approve && !window.confirm("Valider la suppression ? La facture sera supprimée définitivement.")) return;
    setError(null);
    startTransition(async () => {
      const result = await decideDeletionAction({ id, approve, note });
      if (result.success) router.refresh();
      else setError(result.error);
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        <Button type="button" size="sm" disabled={pending} onClick={() => decide(true)}>
          <Check />
          Valider la suppression
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => decide(false)}>
          <X />
          Refuser
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-xs font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
