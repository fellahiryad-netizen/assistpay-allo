"use client";

import { RouteError } from "@/components/common/route-error";

/** Erreur de la page. */
export default function MailAddressesError({ error, reset }: Readonly<{ error: Error & { digest?: string }; reset: () => void }>): React.JSX.Element {
  return <RouteError error={error} reset={reset} title="Les adresses courrier n'ont pas pu s'afficher" />;
}
