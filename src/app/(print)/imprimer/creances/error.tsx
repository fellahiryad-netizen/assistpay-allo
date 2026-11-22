"use client";

import { RouteError } from "@/components/common/route-error";

/** Erreur de la page. */
export default function PrintReceivablesError({ error, reset }: Readonly<{ error: Error & { digest?: string }; reset: () => void }>): React.JSX.Element {
  return <RouteError error={error} reset={reset} title="L'état des créances n'a pas pu être préparé" />;
}
