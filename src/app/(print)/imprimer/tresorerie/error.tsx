"use client";

import { RouteError } from "@/components/common/route-error";

/** Erreur de l'impression de la trésorerie. */
export default function TreasuryPrintError({ error, reset }: Readonly<{ error: Error & { digest?: string }; reset: () => void }>): React.JSX.Element {
  return <RouteError error={error} reset={reset} title="Impression indisponible" />;
}
