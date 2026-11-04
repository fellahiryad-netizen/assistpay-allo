import type { Metadata } from "next";
import Link from "next/link";
import { Download } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { can } from "@/features/access/services/access-rules";
import { PageHeader } from "@/components/common/page-header";
import { StateMessage } from "@/components/common/state-message";
import { buttonVariants } from "@/components/ui/button";
import { AdvanceGrid } from "@/features/partners/components/advance-grid";
import { advanceTable, type AdvanceClient } from "@/features/partners/services/advance-table";
import { todayIso } from "@/utils/dates";

export const metadata: Metadata = { title: "Tableau de paiement CAAT / CAAR" };

/** Tableau de paiement par succursale (CAAT et CAAR), pour pointer les avances avec le tableau de régularisation. */
export default async function AdvancesPage({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>): Promise<React.JSX.Element> {
  const user = await requireUser();
  const raw = await searchParams;
  const first = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value);
  const client: AdvanceClient = first(raw.client) === "CAAR" ? "CAAR" : "CAAT";
  const year = Number(first(raw.annee)) || Number(todayIso().slice(0, 4));
  const result = await advanceTable(user, client, year);
  if (!result.success) return <StateMessage kind={result.code === "FORBIDDEN" ? "forbidden" : "error"} title="Tableau indisponible" message={result.error} />;
  const table = result.data;
  const link = (c: AdvanceClient, y: number): string => `/avances?client=${c}&annee=${y}`;
  return (
    <>
      <PageHeader title="Tableau de paiement CAAT / CAAR" description="Une ligne par succursale, une colonne par mois : facturé, encaissé et reste à encaisser. Cliquez sur une case pour voir les factures." />
      <div className="mb-3 flex flex-wrap items-center gap-1">
        {(["CAAT", "CAAR"] as const).map((c) => (
          <Link key={c} href={link(c, year)} className={buttonVariants({ size: "sm", variant: client === c ? "default" : "outline" })}>
            {c}
          </Link>
        ))}
        <span className="mx-2 h-5 w-px bg-border" />
        {table.years.map((y) => (
          <Link key={y} href={link(client, y)} className={buttonVariants({ size: "sm", variant: year === y ? "default" : "outline" })}>
            {y}
          </Link>
        ))}
        {can(user, "A_EXPORT", "EDIT") ? (
          <a href={`/api/avances?client=${client}&annee=${year}`} className={buttonVariants({ size: "sm", variant: "outline", className: "ml-auto" })}>
            <Download className="mr-1 h-4 w-4" aria-hidden /> Excel
          </a>
        ) : null}
      </div>
      <AdvanceGrid table={table} />
    </>
  );
}
