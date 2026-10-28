"use client";

import { useEffect } from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Barre d'impression (masquée à l'impression) ; ouvre la fenêtre d'impression à l'arrivée sur la page. */
export function PrintToolbar({ title, autoPrint = true }: Readonly<{ title: string; autoPrint?: boolean }>): React.JSX.Element {
  useEffect(() => {
    if (!autoPrint) return;
    const timer = setTimeout(() => window.print(), 600);
    return () => clearTimeout(timer);
  }, [autoPrint]);
  return (
    <div className="no-print mx-auto mb-4 flex max-w-3xl items-center justify-between gap-3 px-4">
      <p className="text-sm text-muted-foreground">{title} — choisissez « Enregistrer au format PDF » pour obtenir le fichier.</p>
      <Button type="button" onClick={() => window.print()}>
        <Printer />
        Imprimer
      </Button>
    </div>
  );
}
