"use client";

import { RouteError } from "@/components/common/route-error";

/** Erreur de la page. */
export default function PartnersError({ error, reset }: Readonly<{ error: Error & { digest?: string }; reset: () => void }>): React.JSX.Element {
  return <RouteError error={error} reset={reset} title="Les partenaires n'ont pas pu s'afficher" />;
}
