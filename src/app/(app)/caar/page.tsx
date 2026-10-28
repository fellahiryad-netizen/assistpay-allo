import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/common/page-header";
import { StateMessage } from "@/components/common/state-message";
import { TabsNav } from "@/components/common/tabs-nav";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CaarImporter } from "@/features/caar/components/caar-importer";
import { listProductions } from "@/features/caar/services/caar-service";
import { todayIso } from "@/utils/dates";
import { formatDA } from "@/utils/format";

export const metadata: Metadata = { title: "CAAR production" };

/** CAAR : contrôle des fichiers de production des succursales et préparation de la facture. */
export default async function CaarPage({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>): Promise<React.JSX.Element> {
  const user = await requireUser();
  const raw = await searchParams;
  const tab = (Array.isArray(raw.onglet) ? raw.onglet[0] : raw.onglet) === "importer" ? "importer" : "productions";
  const result = await listProductions(user);
  if (!result.success) return <StateMessage kind={result.code === "FORBIDDEN" ? "forbidden" : "error"} title="Production CAAR indisponible" message={result.error} />;
  const { items, canEdit } = result.data;
  const today = todayIso();
  const previousMonth = Number(today.slice(5, 7)) === 1 ? 12 : Number(today.slice(5, 7)) - 1;
  const previousYear = Number(today.slice(5, 7)) === 1 ? Number(today.slice(0, 4)) - 1 : Number(today.slice(0, 4));
  return (
    <>
      <PageHeader title="CAAR production" description="Contrôle des fichiers de production envoyés par les succursales : anomalies, TCD par agence, part ALLO 47 %, avance 90 % et facture." />
      <TabsNav
        tabs={[
          { href: "/caar", label: "Productions contrôlées", active: tab === "productions", count: items.length },
          ...(canEdit ? [{ href: "/caar?onglet=importer", label: "Contrôler un fichier", active: tab === "importer" }] : []),
        ]}
      />
      {tab === "importer" && canEdit ? (
        <CaarImporter year={previousYear} month={previousMonth} />
      ) : items.length === 0 ? (
        <StateMessage kind="empty" title="Aucune production contrôlée" message="Déposez le fichier de production d'une succursale dans l'onglet « Contrôler un fichier »." />
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Période</TableHead>
                <TableHead>Succursale</TableHead>
                <TableHead className="text-right">Polices</TableHead>
                <TableHead className="text-right">Prime nette</TableHead>
                <TableHead className="text-right">TTC à facturer</TableHead>
                <TableHead>Anomalies</TableHead>
                <TableHead>Facture</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="whitespace-nowrap">{item.periodLabel}</TableCell>
                  <TableCell>
                    <Link href={`/caar/${item.id}`} className="font-medium hover:underline">
                      {item.succursale}
                    </Link>
                    <p className="max-w-56 truncate text-xs text-muted-foreground">{item.fichier}</p>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{item.totals.n}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatDA(item.totals.prime)}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{formatDA(item.totals.ttc)}</TableCell>
                  <TableCell>{item.anomalies ? <Badge variant="warning">{item.anomalies}</Badge> : <Badge variant="success">Aucune</Badge>}</TableCell>
                  <TableCell>{item.invoice ? <Badge variant="success">N° {item.invoice.num}</Badge> : <Badge variant="muted">À facturer</Badge>}</TableCell>
                  <TableCell className="text-right">
                    <Link href={`/caar/${item.id}`} className={buttonVariants({ size: "sm", variant: "outline" })}>
                      Ouvrir
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
