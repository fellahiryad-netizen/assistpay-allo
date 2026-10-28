"use client";

import { RouteError } from "@/components/common/route-error";

/** Erreur de la liste des factures. */
export default function InvoicesError({ error, reset }: Readonly<{ error: Error & { digest?: string }; reset: () => void }>): React.JSX.Element {
  return <RouteError error={error} reset={reset} title="La liste des factures n'a pas pu s'afficher" />;
}
