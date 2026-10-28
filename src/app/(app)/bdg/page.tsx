import type { Metadata } from "next";
import Link from "next/link";
import { FilePlus2 } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/common/page-header";
import { StateMessage } from "@/components/common/state-message";
import { TabsNav } from "@/components/common/tabs-nav";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can } from "@/features/access/services/access-rules";
import { BdgSettleButton } from "@/features/bdg/components/bdg-settle-button";
import { bdgQuerySchema } from "@/features/bdg/schemas";
import { listBdg } from "@/features/bdg/services/bdg-service";
import { IssuedList } from "@/features/billing/components/issued-list";
import { listIssued } from "@/features/billing/services/billing-service";
import { todayIso } from "@/utils/dates";
import { formatDA, formatDate } from "@/utils/format";

export const metadata: Metadata = { title: "BDG débours et frais" };

/** Suivi BDG : débours et frais de gestion à encaisser, factures BDG établies. */
export default async function BdgPage({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>): Promise<React.JSX.Element> {
  const user = await requireUser();
  const raw = await searchParams;
  const one = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value) || undefined;
  const tab = one(raw.onglet) ?? "suivi";
  const query = bdgQuerySchema.parse({ etat: one(raw.etat), categorie: one(raw.categorie) });
  const [result, issued] = await Promise.all([listBdg(user, query), tab === "factures" ? listIssued(user, "bdg") : Promise.resolve(null)]);
  if (!result.success) return <StateMessage kind={result.code === "FORBIDDEN" ? "forbidden" : "error"} title="Suivi BDG indisponible" message={result.error} />;
  const data = result.data;
  const today = todayIso();
  const href = (patch: Record<string, string>): string => {
    const params = new URLSearchParams({ onglet: "suivi", etat: query.etat, ...(query.categorie ? { categorie: query.categorie } : {}), ...patch });
    return `/bdg?${params.toString()}`;
  };
  return (
    <>
      <PageHeader
        title="BDG débours et frais de gestion"
        description="Factures bris de glace : débours et frais de gestion réglés séparément ; la facture est soldée quand les deux le sont."
        actions={
          can(user, "FACT", "EDIT") ? (
            <>
              <Link href="/facturation/nouvelle?portee=bdg" className={buttonVariants()}>
                <FilePlus2 />
                Factures BDG CAAT / TRUST
              </Link>
              <Link href="/facturation/nouvelle?portee=gam" className={buttonVariants({ variant: "outline" })}>
                Factures BDG GAM
              </Link>
            </>
          ) : undefined
        }
      />
      <TabsNav
        tabs={[
          { href: "/bdg?onglet=suivi", label: "Suivi des encaissements", active: tab === "suivi" },
          { href: "/bdg?onglet=factures", label: "Factures BDG établies", active: tab === "factures" },
        ]}
      />
      {tab === "factures" ? (
        issued && issued.success && issued.data.length ? <IssuedList items={issued.data} /> : <StateMessage kind="empty" title="Aucune facture BDG établie dans AssistPay" />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              ["Débours à encaisser", formatDA(data.summary.deboursDue)],
              ["Frais de gestion à encaisser", formatDA(data.summary.fraisDue)],
              ["Non répartis (à compléter)", `${formatDA(data.summary.unsplitAmount)} · ${data.summary.unsplitCount} fact.`],
              ["Partiellement réglées", `${data.summary.partialCount} facture(s)`],
            ].map(([label, value]) => (
              <Card key={label} className="p-4">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="font-semibold tabular-nums">{value}</p>
              </Card>
            ))}
          </div>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {(
              [
                ["ouvert", "En attente"],
                ["REGLE", "Réglées"],
                ["ANNULE", "Annulées"],
                ["tous", "Toutes"],
              ] as const
            ).map(([value, label]) => (
              <Link key={value} href={href({ etat: value })} className={buttonVariants({ size: "sm", variant: query.etat === value ? "default" : "outline" })}>
                {label}
              </Link>
            ))}
            <form method="get" className="ml-auto flex gap-2">
              <input type="hidden" name="onglet" value="suivi" />
              <input type="hidden" name="etat" value={query.etat} />
              <NativeSelect name="categorie" defaultValue={query.categorie ?? ""} aria-label="Catégorie">
                <option value="">Toutes les catégories</option>
                {data.categories.map((categorie) => (
                  <option key={categorie} value={categorie}>
                    {categorie}
                  </option>
                ))}
              </NativeSelect>
              <Button type="submit" variant="outline">
                Filtrer
              </Button>
            </form>
          </div>
          {data.items.length === 0 ? (
            <StateMessage kind="empty" title="Aucune facture BDG dans cette sélection" />
          ) : (
            <div className="rounded-lg border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Facture</TableHead>
                    <TableHead>Succursale / période</TableHead>
                    <TableHead className="text-right">Débours</TableHead>
                    <TableHead className="text-right">Frais de gestion</TableHead>
                    <TableHead className="text-right">Reste</TableHead>
                    <TableHead>État</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="whitespace-nowrap">
                        <Link href={`/factures/${item.id}`} className="font-medium hover:underline">
                          {item.numero || "—"}
                        </Link>
                        <span className="block text-xs text-muted-foreground">{item.categorie}</span>
                      </TableCell>
                      <TableCell className="max-w-80">
                        <span className="block truncate">{item.succursale || item.tiers}</span>
                        <span className="block truncate text-xs text-muted-foreground">{item.periode ? `Période ${item.periode} – ` : ""}{item.libelle}</span>
                      </TableCell>
                      {item.split ? (
                        <>
                          <TableCell className="whitespace-nowrap text-right">
                            <span className="tabular-nums">{formatDA(item.debours)}</span>
                            <span className="block text-xs text-muted-foreground">{item.factureDebours}</span>
                            {item.regDebours ? (
                              <span className="block text-xs text-success">réglés le {formatDate(item.regDebours)}</span>
                            ) : item.status === "EN_ATTENTE" && data.canEdit && item.debours > 0 ? (
                              <BdgSettleButton id={item.id} part="debours" amount={item.debours} label="Régler les débours" today={today} />
                            ) : null}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-right">
                            <span className="tabular-nums">{formatDA(item.frais)}</span>
                            <span className="block text-xs text-muted-foreground">{item.factureFrais}</span>
                            {item.regFrais ? (
                              <span className="block text-xs text-success">réglés le {formatDate(item.regFrais)}</span>
                            ) : item.status === "EN_ATTENTE" && data.canEdit && item.frais > 0 ? (
                              <BdgSettleButton id={item.id} part="frais" amount={item.frais} label="Régler les frais" today={today} />
                            ) : null}
                          </TableCell>
                        </>
                      ) : (
                        <TableCell colSpan={2} className="text-sm text-warning">
                          Total {formatDA(item.montant)}, répartition débours / frais à saisir
                        </TableCell>
                      )}
                      <TableCell className="whitespace-nowrap text-right font-medium tabular-nums">{formatDA(item.remaining)}</TableCell>
                      <TableCell>
                        <div className="flex flex-col items-start gap-1">
                          <Badge variant={item.status === "REGLE" ? "success" : item.status === "ANNULE" ? "muted" : item.partial ? "accent" : "warning"}>
                            {item.status === "REGLE" ? "Réglée" : item.status === "ANNULE" ? "Annulée" : item.partial ? "Partielle" : "En attente"}
                          </Badge>
                          {!item.split && item.status === "EN_ATTENTE" && data.canEdit ? <BdgSettleButton id={item.id} part="tout" amount={item.remaining} label="Régler" today={today} /> : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      )}
    </>
  );
}
