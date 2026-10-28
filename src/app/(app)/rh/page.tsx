import type { Metadata } from "next";
import Link from "next/link";
import { Download, Lock } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/common/page-header";
import { StateMessage } from "@/components/common/state-message";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { HrEntryDialog } from "@/features/hr/components/hr-entry-dialog";
import { hrQuerySchema } from "@/features/hr/schemas";
import { listHr } from "@/features/hr/services/hr-service";
import { HR_GROUP_LABELS, type HrGroup, type HrTotals } from "@/features/hr/types";
import { cn } from "@/utils/cn";
import { MONTHS_FR, todayIso } from "@/utils/dates";
import { formatDA, formatDate } from "@/utils/format";

export const metadata: Metadata = { title: "RH (salaires)" };

const GROUPS: HrGroup[] = ["sal", "cnas", "g50", "autre"];
const sum = (totals: HrTotals): number => GROUPS.reduce((acc, group) => acc + totals[group], 0);
const monthLabel = (key: string): string => (key ? `${MONTHS_FR[Number(key.slice(5)) - 1] ?? ""} ${key.slice(0, 4)}` : "Date non renseignée");

/** RH : salaires, cotisations et charges de personnel (confidentiel). */
export default async function HrPage({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>): Promise<React.JSX.Element> {
  const user = await requireUser();
  const raw = await searchParams;
  const one = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value) || undefined;
  const query = hrQuerySchema.parse({ annee: one(raw.annee), mois: one(raw.mois), nature: one(raw.nature), q: one(raw.q) });
  const result = await listHr(user, query);
  if (!result.success) return <StateMessage kind={result.code === "FORBIDDEN" ? "forbidden" : "error"} title="RH indisponible" message={result.error} />;
  const data = result.data;
  const today = todayIso();
  const link = (patch: Record<string, string | undefined>): string => {
    const params = new URLSearchParams();
    const merged = { annee: String(data.year), mois: query.mois, nature: query.nature, q: query.q, ...patch };
    for (const [key, value] of Object.entries(merged)) if (value) params.set(key, value);
    return `/rh?${params.toString()}`;
  };
  const exportParams = new URLSearchParams(Object.entries({ annee: String(data.year), mois: query.mois ?? "", nature: query.nature ?? "", q: query.q ?? "" }).filter(([, value]) => value));
  return (
    <>
      <PageHeader
        title="RH (salaires)"
        description="Salaires, CNAS / CASNOS, G50 / IRG, avances et primes. Le total de chaque mois est reporté dans le suivi des factures (ligne agrégée)."
        actions={
          <>
            <Badge variant="destructive">
              <Lock className="size-3" aria-hidden />
              Confidentiel
            </Badge>
            <a href={`/api/rh/export?${exportParams.toString()}`} className={buttonVariants({ variant: "outline" })}>
              <Download />
              Exporter en Excel
            </a>
            {data.canEdit ? <HrEntryDialog beneficiaries={data.beneficiaries} today={today} /> : null}
          </>
        }
      />
      <div className="mb-4 flex flex-wrap gap-1">
        {[...data.years.map(String), "all"].map((year) => (
          <Link key={year} href={link({ annee: year, mois: undefined })} className={buttonVariants({ size: "sm", variant: String(data.year) === year ? "default" : "outline" })}>
            {year === "all" ? "Toutes" : year}
          </Link>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {[...GROUPS.map((group) => [HR_GROUP_LABELS[group], data.totals[group]] as const), ["Total charges de personnel", sum(data.totals)] as const].map(([label, value]) => (
          <Card key={label} className="p-3">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-lg font-semibold tabular-nums">{formatDA(value)}</p>
          </Card>
        ))}
      </div>
      <h2 className="mb-2 mt-6 text-lg font-semibold">Synthèse mensuelle</h2>
      <div className="overflow-x-auto rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Mois</TableHead>
              {GROUPS.map((group) => (
                <TableHead key={group} className="text-right">
                  {HR_GROUP_LABELS[group]}
                </TableHead>
              ))}
              <TableHead className="text-right">Total du mois</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.months.map((month) => (
              <TableRow key={month.key || "nd"} className={cn(query.mois === month.key && "bg-primary/5")}>
                <TableCell>
                  <Link href={link({ mois: month.key || undefined })} className="font-medium hover:underline">
                    {monthLabel(month.key)}
                  </Link>
                </TableCell>
                {GROUPS.map((group) => (
                  <TableCell key={group} className="text-right tabular-nums">
                    {formatDA(month.totals[group])}
                  </TableCell>
                ))}
                <TableCell className="text-right font-semibold tabular-nums">{formatDA(sum(month.totals))}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="mb-2 mt-6 flex flex-wrap items-end justify-between gap-2">
        <h2 className="text-lg font-semibold">Saisies</h2>
        <p className="text-sm text-muted-foreground">
          {data.totalCount} saisie(s), total {formatDA(data.totalAmount)}
        </p>
      </div>
      <form action="/rh" className="mb-3 flex flex-wrap gap-2">
        <input type="hidden" name="annee" value={String(data.year)} />
        <Input name="q" defaultValue={query.q ?? ""} placeholder="Rechercher un employé, un organisme, un libellé" aria-label="Rechercher dans le RH" className="max-w-sm" />
        <NativeSelect name="nature" defaultValue={query.nature ?? ""} aria-label="Nature" className="w-56">
          <option value="">Toutes les natures</option>
          {data.natures.map((nature) => (
            <option key={nature}>{nature}</option>
          ))}
        </NativeSelect>
        <NativeSelect name="mois" defaultValue={query.mois ?? ""} aria-label="Mois" className="w-48">
          <option value="">Tous les mois</option>
          {data.months
            .filter((month) => month.key)
            .map((month) => (
              <option key={month.key} value={month.key}>
                {monthLabel(month.key)}
              </option>
            ))}
        </NativeSelect>
        <button type="submit" className={buttonVariants({ variant: "outline" })}>
          Filtrer
        </button>
      </form>
      {data.entries.length === 0 ? (
        <StateMessage kind="empty" title="Aucune saisie" message="Aucune saisie RH ne correspond aux filtres." />
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Nature</TableHead>
                <TableHead>Employé / organisme</TableHead>
                <TableHead>Libellé</TableHead>
                <TableHead className="text-right">Montant</TableHead>
                <TableHead>Règlement</TableHead>
                <TableHead>Par</TableHead>
                {data.canEdit ? <TableHead /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.entries.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="whitespace-nowrap">{entry.date ? formatDate(entry.date) : monthLabel(entry.mois)}</TableCell>
                  <TableCell>{entry.nature}</TableCell>
                  <TableCell className="font-medium">{entry.beneficiaire || "—"}</TableCell>
                  <TableCell className="max-w-72 truncate text-muted-foreground">{entry.libelle}</TableCell>
                  <TableCell className={cn("whitespace-nowrap text-right tabular-nums", entry.sens === "RETOUR" && "text-destructive")}>
                    {entry.sens === "RETOUR" ? "− " : ""}
                    {formatDA(entry.montant)}
                  </TableCell>
                  <TableCell className="text-xs">
                    {entry.mode === "CHEQUE" ? `Chèque ${entry.cheque}` : entry.mode === "VIRMT" ? "Virement" : ""}
                    {entry.banque ? `, ${entry.banque}` : ""}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{entry.par}</TableCell>
                  {data.canEdit ? (
                    <TableCell className="text-right">
                      <HrEntryDialog
                        entry={entry}
                        beneficiaries={data.beneficiaries}
                        today={today}
                      />
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {data.totalCount > data.entries.length ? <p className="p-3 text-sm text-muted-foreground">Les {data.entries.length} plus récentes sont affichées : affinez les filtres pour voir les autres.</p> : null}
        </div>
      )}
    </>
  );
}
