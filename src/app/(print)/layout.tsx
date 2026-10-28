import type { ReactNode } from "react";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Mise en page des documents à imprimer (sans menu ni en-tête). */
export default async function PrintLayout({ children }: Readonly<{ children: ReactNode }>): Promise<React.JSX.Element> {
  await requireUser();
  return <div className="min-h-screen bg-muted py-6 print:bg-white print:py-0">{children}</div>;
}
