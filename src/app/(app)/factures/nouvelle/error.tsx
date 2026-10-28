"use client";

import { RouteError } from "@/components/common/route-error";

/** Erreur du formulaire d'ajout. */
export default function NewInvoiceError({ error, reset }: Readonly<{ error: Error & { digest?: string }; reset: () => void }>): React.JSX.Element {
  return <RouteError error={error} reset={reset} />;
}
