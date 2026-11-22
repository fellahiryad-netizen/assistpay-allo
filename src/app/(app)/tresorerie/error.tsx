"use client";

import { RouteError } from "@/components/common/route-error";

/** Erreur de la page Trésorerie. */
export default function TreasuryError({ error, reset }: Readonly<{ error: Error & { digest?: string }; reset: () => void }>): React.JSX.Element {
  return <RouteError error={error} reset={reset} title="Trésorerie indisponible" />;
}
