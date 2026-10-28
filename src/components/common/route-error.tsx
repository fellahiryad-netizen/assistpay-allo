"use client";

import { useEffect } from "react";
import { RotateCcw } from "lucide-react";
import { StateMessage } from "@/components/common/state-message";
import { Button } from "@/components/ui/button";

/** Propriétés de l'écran d'erreur de route. */
export interface RouteErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
  title?: string;
}

/** Écran affiché par les fichiers `error.tsx` : message clair et bouton pour réessayer. */
export function RouteError({ error, reset, title = "Cette page n'a pas pu s'afficher" }: Readonly<RouteErrorProps>): React.JSX.Element {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <StateMessage
      kind="error"
      title={title}
      message={error.digest ? `Référence de l'incident : ${error.digest}` : "Réessayez dans un instant."}
      action={
        <Button type="button" variant="outline" onClick={reset}>
          <RotateCcw />
          Réessayer
        </Button>
      }
    />
  );
}
