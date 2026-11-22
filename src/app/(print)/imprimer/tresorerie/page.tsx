import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { PrintToolbar } from "@/components/common/print-toolbar";
import { StateMessage } from "@/components/common/state-message";
import { TreasuryPrint } from "@/features/treasury/components/treasury-print";
import { canAccessTreasury } from "@/features/treasury/services/treasury-access";
import { getTreasuryView } from "@/features/treasury/services/treasury-service";

export const metadata: Metadata = { title: "Trésorerie (impression)" };

/** Impression de la trésorerie en noir et blanc. Même contrôle d'accès que la page : Administrateur, Direction, Comptable. */
export default async function PrintTreasuryPage({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>): Promise<React.JSX.Element> {
  const user = await requireUser();
  if (!canAccessTreasury(user)) return <StateMessage kind="forbidden" title="Trésorerie" message="Cet onglet est réservé à l'administrateur, à la direction et à la comptable." className="mx-auto max-w-xl" />;
  const raw = await searchParams;
  const value = Array.isArray(raw.demandes) ? raw.demandes[0] : raw.demandes;
  const result = await getTreasuryView(user, { demandes: value === "1" }, "impression");
  if (!result.success) return <StateMessage kind="error" title="Trésorerie indisponible" message={result.error} className="mx-auto max-w-xl" />;
  return (
    <>
      <PrintToolbar title="Trésorerie" />
      <TreasuryPrint view={result.data} />
    </>
  );
}
