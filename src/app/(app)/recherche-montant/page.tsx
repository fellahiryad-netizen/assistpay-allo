import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/common/page-header";
import { StateMessage } from "@/components/common/state-message";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { searchByAmount } from "@/features/search/services/amount-search";
import { formatDA, formatDate } from "@/utils/format";

export const metadata: Metadata = { title: "Recherche par montant" };

/** Recherche d'un montant dans les factures, le relevé bancaire, les demandes de paiement et les envois de virements. */
export default async function AmountSearchPage({ searchParams }: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>): Promise<React.JSX.Element> {
  const user = await requireUser();
  const raw = await searchParams;
  const value = Array.isArray(raw.m) ? raw.m[0] : raw.m;
  const query = (value ?? "").trim();
  const result = query ? await searchByAmount(user, query) : null;
  return (
    <>
      <PageHeader title="Recherche par montant" description="Tapez un montant pour savoir où il se trouve : facture, relevé bancaire, demande de paiement ou envoi de virements. Sans décimales, tous les montants de cette tranche sont trouvés." />
      <form method="get" className="mb-4 flex max-w-xl gap-2" role="search">
        <input name="m" defaultValue={query} inputMode="decimal" autoComplete="off" autoFocus placeholder="Ex. 5 435 384,50" aria-label="Montant à chercher" className="h-10 flex-1 rounded-md border bg-background px-3 text-base" />
        <Button type="submit">Chercher</Button>
      </form>
      {result === null ? null : !result.success ? (
        <StateMessage kind="error" title="Recherche impossible" message={result.error} />
      ) : result.data.length === 0 ? (
        <StateMessage kind="empty" title="Montant introuvable" message="Ce montant n'apparaît dans aucune source à laquelle vous avez accès." />
      ) : (
        <Card className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Où</TableHead>
                <TableHead>Élément</TableHead>
                <TableHead className="text-right">Montant</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>État</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.data.map((hit, index) => (
                <TableRow key={`${hit.href}-${index}`}>
                  <TableCell className="whitespace-nowrap font-medium">{hit.where}</TableCell>
                  <TableCell>
                    <p>{hit.title}</p>
                    <p className="max-w-xl truncate text-xs text-muted-foreground" title={hit.detail}>
                      {hit.detail}
                    </p>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatDA(hit.amount)}</TableCell>
                  <TableCell className="whitespace-nowrap text-xs">{hit.date ? formatDate(hit.date) : ""}</TableCell>
                  <TableCell className="text-xs">{hit.state}</TableCell>
                  <TableCell>
                    <Link href={hit.href} className="text-primary underline">
                      Ouvrir
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </>
  );
}
