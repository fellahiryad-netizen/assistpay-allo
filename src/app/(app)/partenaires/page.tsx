import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/common/page-header";
import { StateMessage } from "@/components/common/state-message";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { partnersOverview } from "@/features/partners/services/partner-service";
import { FORECAST_BUCKETS } from "@/features/partners/types";
import { cn } from "@/utils/cn";
import { todayIso } from "@/utils/dates";
import { formatDA } from "@/utils/format";

export const metadata: Metadata = { title: "Partenaires" };

/** Partenaires : créances, encaissements, délais et prévision. */
export default async function PartnersPage({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>): Promise<React.JSX.Element> {
  const user = await requireUser();
  const raw = await searchParams;
  const currentYear = Number(todayIso().slice(0, 4));
  const yearParam = Array.isArray(raw.annee) ? raw.annee[0] : raw.annee;
  const year: number | "all" = yearParam === "all" ? "all" : Number(yearParam) || currentYear;
  const result = await partnersOverview(user, year);
  if (!result.success) return <StateMessage kind={result.code === "FORBIDDEN" ? "forbidden" : "error"} title="Partenaires indisponibles" message={result.error} />;
  const { partners, forecast } = result.data;
  return (
    <>
      <PageHeader
        title="Partenaires"
        description={`Créances, encaissements, délais de paiement et prévisions par partenaire (${year === "all" ? "toutes années" : `année ${year}`} pour facturé et encaissé ; solde dû toutes années).`}
      />
      <div className="mb-4 flex flex-wrap gap-1">
        {[currentYear, currentYear - 1, currentYear - 2].map((value) => (
          <Link key={value} href={`/partenaires?annee=${value}`} className={buttonVariants({ size: "sm", variant: year === value ? "default" : "outline" })}>
            {value}
          </Link>
        ))}
        <Link href="/partenaires?annee=all" className={buttonVariants({ size: "sm", variant: year === "all" ? "default" : "outline" })}>
          Toutes années
        </Link>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {partners.map((partner) => (
          <Link key={partner.key} href={`/partenaires/${encodeURIComponent(partner.key)}?annee=${year}`}>
            <Card className="flex h-full flex-col gap-1.5 p-4 transition-colors hover:border-primary">
              <p className="font-semibold">{partner.key}</p>
              {(
                [
                  ["Solde dû", formatDA(partner.balance), partner.balance > 0],
                  ["En attente", `${partner.pending} facture(s)`, false],
                  [`Facturé ${year === "all" ? "" : year}`, formatDA(partner.invoiced), false],
                  [`Encaissé ${year === "all" ? "" : year}`, formatDA(partner.collected), false],
                  ["Délai médian de paiement", partner.medianDelay !== null ? `${partner.medianDelay} j` : "—", false],
                  ["Plus ancien impayé", partner.oldestDays ? `${partner.oldestDays} j` : partner.pending ? "date inconnue" : "—", Boolean(partner.medianDelay && partner.oldestDays > 2 * partner.medianDelay)],
                ] as const
              ).map(([label, value, alert]) => (
                <div key={label} className="flex justify-between gap-2 text-sm">
                  <span className="text-muted-foreground">{label}</span>
                  <span className={cn("tabular-nums", alert && "font-semibold text-destructive")}>{value}</span>
                </div>
              ))}
            </Card>
          </Link>
        ))}
      </div>
      <h2 className="mb-2 mt-8 text-lg font-semibold">Prévision des encaissements</h2>
      <p className="mb-3 text-sm text-muted-foreground">Calculée avec le délai médian réel de chaque partenaire (60 jours par défaut s&apos;il est inconnu).</p>
      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Partenaire</TableHead>
              {FORECAST_BUCKETS.map(([key, label]) => (
                <TableHead key={key} className="text-right">
                  {label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {partners
              .filter((partner) => partner.balance > 0)
              .map((partner) => (
                <TableRow key={partner.key}>
                  <TableCell className="font-medium">{partner.key}</TableCell>
                  {FORECAST_BUCKETS.map(([key]) => {
                    const value = forecast.byPartner[partner.key]?.[key] ?? 0;
                    return (
                      <TableCell key={key} className={cn("whitespace-nowrap text-right tabular-nums", key === "retard" && value && "text-destructive")}>
                        {value ? formatDA(value) : "—"}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            <TableRow className="font-semibold">
              <TableCell>Total</TableCell>
              {FORECAST_BUCKETS.map(([key]) => (
                <TableCell key={key} className="whitespace-nowrap text-right tabular-nums">
                  {formatDA(forecast.totals[key])}
                </TableCell>
              ))}
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </>
  );
}
