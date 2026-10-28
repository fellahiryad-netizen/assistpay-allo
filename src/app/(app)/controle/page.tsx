import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/common/page-header";
import { StateMessage } from "@/components/common/state-message";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { qualityReport } from "@/features/quality/services/quality-service";
import { cn } from "@/utils/cn";
import { formatDA, formatDate } from "@/utils/format";

export const metadata: Metadata = { title: "Contrôle qualité" };

/** Contrôle qualité des données : points à corriger, avec la liste des lignes concernées. */
export default async function QualityPage({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>): Promise<React.JSX.Element> {
  const user = await requireUser();
  const raw = await searchParams;
  const selected = Array.isArray(raw.regle) ? raw.regle[0] : raw.regle;
  const result = await qualityReport(user);
  if (!result.success) return <StateMessage kind={result.code === "FORBIDDEN" ? "forbidden" : "error"} title="Contrôle qualité indisponible" message={result.error} />;
  const { rules, total } = result.data;
  const rule = rules.find((entry) => entry.key === selected);
  return (
    <>
      <PageHeader title="Contrôle qualité" description={total ? `${total} point(s) à vérifier dans les données. Ouvrez une ligne pour la corriger.` : "Aucun point signalé : les données sont propres."} />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {rules.map((entry) => (
          <Link key={entry.key} href={entry.href ?? `/controle?regle=${entry.key}`}>
            <Card className={cn("flex h-full flex-col gap-1 p-4 transition-colors hover:border-primary", entry.key === selected && "border-primary")}>
              <div className="flex items-start justify-between gap-2">
                <p className="font-medium">{entry.title}</p>
                <Badge variant={entry.count ? "warning" : "success"}>{entry.count}</Badge>
              </div>
              <p className="text-sm text-muted-foreground">{entry.hint}</p>
            </Card>
          </Link>
        ))}
      </div>
      {rule ? (
        <section className="mt-6">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">
              {rule.title} ({rule.count})
            </h2>
            <Link href="/controle" className={buttonVariants({ size: "sm", variant: "outline" })}>
              Fermer la liste
            </Link>
          </div>
          {rule.items.length === 0 ? (
            <StateMessage kind="empty" title="Rien à corriger" message="Aucune ligne concernée." />
          ) : (
            <div className="overflow-x-auto rounded-lg border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Sens</TableHead>
                    <TableHead>Catégorie / tiers</TableHead>
                    <TableHead>N°</TableHead>
                    <TableHead>Libellé</TableHead>
                    <TableHead>Date facture</TableHead>
                    <TableHead>Date règlement</TableHead>
                    <TableHead className="text-right">Montant</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rule.items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>{item.sens === "CREDIT" ? "Crédit" : "Débit"}</TableCell>
                      <TableCell>
                        <span className="font-medium">{item.categorie || "—"}</span>
                        {item.tiers ? <span className="block text-xs text-muted-foreground">{item.tiers}</span> : null}
                      </TableCell>
                      <TableCell>{item.numero || "—"}</TableCell>
                      <TableCell className="max-w-72 truncate">{item.libelle}</TableCell>
                      <TableCell className="whitespace-nowrap">{formatDate(item.dateFacture)}</TableCell>
                      <TableCell className="whitespace-nowrap">{formatDate(item.dateOperation)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatDA(item.montant)}</TableCell>
                      <TableCell className="text-right">
                        <Link href={`/factures/${item.id}`} className={buttonVariants({ size: "sm", variant: "outline" })}>
                          Ouvrir
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {rule.count > rule.items.length ? <p className="p-3 text-sm text-muted-foreground">Les {rule.items.length} plus anciennes sont affichées sur {rule.count}.</p> : null}
            </div>
          )}
        </section>
      ) : null}
    </>
  );
}
