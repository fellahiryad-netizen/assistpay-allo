import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { DonutChart } from "@/components/common/donut-chart";
import { PageHeader } from "@/components/common/page-header";
import { StateMessage } from "@/components/common/state-message";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { InvoiceImportDialog } from "@/features/invoices/components/invoice-import-dialog";
import { providerBalances } from "@/features/invoices/services/provider-service";
import { formatDA, formatDate } from "@/utils/format";

export const metadata: Metadata = { title: "Prestataires" };

/** Prestataires : factures reçues, soldes, impayés et accès aux demandes de paiement. */
export default async function ProvidersPage({ searchParams }: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>): Promise<React.JSX.Element> {
  const user = await requireUser();
  const raw = await searchParams;
  const one = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value) || undefined;
  const year = Number(one(raw.annee)) || undefined;
  const result = await providerBalances(user, { q: one(raw.q), year });
  if (!result.success) return <StateMessage kind={result.code === "FORBIDDEN" ? "forbidden" : "error"} title="Prestataires indisponibles" message={result.error} />;
  const data = result.data;
  const slices = data.items.filter((item) => item.due > 0).map((item) => ({ label: item.tiers, amount: item.due, count: item.pending }));
  return (
    <>
      <PageHeader
        title="Prestataires"
        description={`Factures des prestataires, soldes et impayés : ${formatDA(data.due)} restant à payer sur ${data.pending} facture(s).`}
        actions={
          data.canEdit ? (
            <>
              <InvoiceImportDialog />
              <Link href="/factures/nouvelle?sens=DEBIT" className={buttonVariants()}>
                <Plus />
                Ajouter une facture prestataire
              </Link>
            </>
          ) : undefined
        }
      />
      <form method="get" className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-4" role="search">
        <Input name="q" defaultValue={one(raw.q) ?? ""} placeholder="Nom du prestataire…" aria-label="Recherche" className="sm:col-span-2" />
        <NativeSelect name="annee" defaultValue={year ? String(year) : ""} aria-label="Année">
          <option value="">Toutes les années</option>
          {data.years.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </NativeSelect>
        <Button type="submit">Filtrer</Button>
      </form>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Reste à payer par prestataire</CardTitle>
            <CardDescription>Factures impayées</CardDescription>
          </CardHeader>
          <CardContent>
            <DonutChart slices={slices} centerLabel="À payer" />
          </CardContent>
        </Card>
        <div className="overflow-x-auto rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Prestataire</TableHead>
                <TableHead className="text-right">Facturé</TableHead>
                <TableHead className="text-right">Réglé</TableHead>
                <TableHead className="text-right">Reste à payer</TableHead>
                <TableHead className="text-right">Impayées</TableHead>
                <TableHead>Dernier règlement</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.slice(0, 300).map((item) => (
                <TableRow key={item.tiers}>
                  <TableCell className="max-w-64 truncate font-medium">{item.tiers}</TableCell>
                  <TableCell className="whitespace-nowrap text-right tabular-nums">{formatDA(item.invoiced)}</TableCell>
                  <TableCell className="whitespace-nowrap text-right tabular-nums">{formatDA(item.paid)}</TableCell>
                  <TableCell className={`whitespace-nowrap text-right font-semibold tabular-nums ${item.due > 0 ? "text-destructive" : ""}`}>{formatDA(item.due)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {item.pending || "—"}
                    {item.oldestDays ? <span className="block text-xs text-muted-foreground">{item.oldestDays} j</span> : null}
                  </TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums">{formatDate(item.lastPaid)}</TableCell>
                  <TableCell className="text-right">
                    <Link href={`/factures?sens=DEBIT&q=${encodeURIComponent(item.tiers)}`} className={buttonVariants({ size: "sm", variant: "outline" })}>
                      Factures
                    </Link>
                    {item.due > 0 ? (
                      <Link href="/demandes" className={`${buttonVariants({ size: "sm", variant: "ghost" })} ml-1`}>
                        Payer
                      </Link>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </>
  );
}
