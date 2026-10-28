"use client";

import { RouteError } from "@/components/common/route-error";

/** Erreur dans l'application connectée. */
export default function AppError({ error, reset }: Readonly<{ error: Error & { digest?: string }; reset: () => void }>): React.JSX.Element {
  return <RouteError error={error} reset={reset} />;
}
