"use client";

import { RouteError } from "@/components/common/route-error";

/** Erreur de la page. */
export default function AdvancesError({ error, reset }: Readonly<{ error: Error & { digest?: string }; reset: () => void }>): React.JSX.Element {
  return <RouteError error={error} reset={reset} title="Le tableau de paiement n'a pas pu s'afficher" />;
}
