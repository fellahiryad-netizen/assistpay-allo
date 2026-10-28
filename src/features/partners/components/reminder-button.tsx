"use client";

import { useState, useTransition } from "react";
import { Mail } from "lucide-react";
import { recordReminderAction } from "@/app/actions/partner-actions";
import { Button } from "@/components/ui/button";

/** Enregistre la relance puis ouvre la lettre à imprimer. */
export function ReminderButton({ partner, branch, threshold }: Readonly<{ partner: string; branch: string; threshold: number }>): React.JSX.Element {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="outline"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await recordReminderAction({ key: partner, succ: branch, seuil: threshold, annee: "all" });
            if (!result.success) {
              setError(result.error);
              return;
            }
            const params = new URLSearchParams({ key: partner, succ: branch, seuil: String(threshold) });
            window.open(`/imprimer/relance?${params.toString()}`, "_blank");
          })
        }
      >
        <Mail />
        Lettre de relance (PDF)
      </Button>
      {error ? <p className="text-xs font-medium text-destructive">{error}</p> : null}
    </div>
  );
}
