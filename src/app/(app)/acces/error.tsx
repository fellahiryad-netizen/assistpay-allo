"use client";

import { RouteError } from "@/components/common/route-error";

/** Erreur du tableau des accès. */
export default function AccessError({ error, reset }: Readonly<{ error: Error & { digest?: string }; reset: () => void }>): React.JSX.Element {
  return <RouteError error={error} reset={reset} />;
}
