import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { StateMessage } from "@/components/common/state-message";
import { TreasuryScreen } from "@/features/treasury/components/treasury-screen";
import { canAccessTreasury } from "@/features/treasury/services/treasury-access";
import { getTreasuryView } from "@/features/treasury/services/treasury-service";

export const metadata: Metadata = { title: "Trésorerie" };

/** Trésorerie : solde du compte AGB, paiements à venir, risque de découvert et simulation. Réservé à l'Administrateur, la Direction et la Comptable. */
export default async function TreasuryPage({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>): Promise<React.JSX.Element> {
  const user = await requireUser();
  if (!canAccessTreasury(user)) return <StateMessage kind="forbidden" title="Trésorerie" message="Cet onglet est réservé à l'administrateur, à la direction et à la comptable." />;
  const raw = await searchParams;
  const value = Array.isArray(raw.demandes) ? raw.demandes[0] : raw.demandes;
  const result = await getTreasuryView(user, { demandes: value === "1" });
  if (!result.success) return <StateMessage kind={result.code === "FORBIDDEN" ? "forbidden" : "error"} title="Trésorerie indisponible" message={result.error} />;
  return <TreasuryScreen view={result.data} />;
}
