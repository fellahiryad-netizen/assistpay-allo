"use client";

import { RouteError } from "@/components/common/route-error";

/** Erreur du journal. */
export default function JournalError({ error, reset }: Readonly<{ error: Error & { digest?: string }; reset: () => void }>): React.JSX.Element {
  return <RouteError error={error} reset={reset} />;
}
