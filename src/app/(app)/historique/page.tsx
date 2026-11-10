import type { Metadata } from "next";
import Link from "next/link";
import { Download } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { can } from "@/features/access/services/access-rules";
import { DonutChart } from "@/components/common/donut-chart";
import { PageHeader } from "@/components/common/page-header";
import { Pagination } from "@/components/common/pagination";
import { StateMessage } from "@/components/common/state-message";
import { TabsNav } from "@/components/common/tabs-nav";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/features/invoices/components/invoice-badges";
import { invoiceQuerySchema } from "@/features/invoices/schemas";
import { HISTORY_YEARS, getHistory } from "@/features/invoices/services/history-service";
import { MODE_LABELS } from "@/features/invoices/types";
import { formatDA, formatDate } from "@/utils/format";

export const metadata: Metadata = { title: "Historique 2023–2025" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === "" ? undefined : raw;
}

/** Historique du suivi bancaire 2023, 2024 et 2025 : synthèse, créances en attente et détail ligne à ligne. */
export default async function HistoryPage({ searchParams }: Readonly<{ searchParams: SearchParams }>): Promise<React.JSX.Element> {
  const user = await requireUser();
  const raw = await searchParams;
  const parsed = invoiceQuerySchema.parse({ sens: first(raw.sens), status: first(raw.status), q: first(raw.q), page: first(raw.page) });
  const requested = Number(first(raw.annee));
  const annee = (HISTORY_YEARS as readonly number[]).includes(requested) ? requested : null;
  const result = await getHistory(user, { ...parsed, annee });
  if (!result.success) return <StateMessage kind={result.code === "FORBIDDEN" ? "forbidden" : "error"} title="Historique indisponible" message={result.error} />;
  const data = result.data;
  const href = (patch: { annee?: number | null; page?: number }): string => {
    const params = new URLSearchParams();
    const year = patch.annee === undefined ? annee : patch.annee;
    if (year) params.set("annee", String(year));
    if (parsed.sens) params.set("sens", parsed.sens);
    if (parsed.status) params.set("status", parsed.status);
    if (parsed.q) params.set("q", parsed.q);
    if (patch.page && patch.page > 1) params.set("page", String(patch.page));
    const search = params.toString();
    return search ? `/historique?${search}` : "/historique";
  };
  const shown = data.years.filter((year) => !annee || year.annee === annee);
  const sum = (pick: (year: (typeof shown)[number]) => number): number => shown.reduce((total, year) => total + pick(year), 0);
  const exportParams = new URLSearchParams({ format: "suivi", ...(annee ? { annee: String(annee) } : {}) });
  return (
    <>
      <PageHeader
        title="Historique 2023 – 2024 – 2025"
        description="Reprise du classeur de suivi bancaire : toutes les lignes avec leur détail, et les créances restant à encaisser."
        actions={
          annee && can(user, "A_EXPORT", "EDIT") ? (
            <a href={`/api/factures/export?${exportParams.toString()}`} className={buttonVariants({ variant: "outline" })}>
              <Download />
              Excel de {annee}
            </a>
          ) : undefined
        }
      />
      <TabsNav
        tabs={[
          { href: href({ annee: null }), label: "2023 – 2025", active: annee === null },
          ...HISTORY_YEARS.map((year) => ({ href: href({ annee: year }), label: String(year), active: annee === year })),
        ]}
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ["Encaissé (partenaires réglés)", formatDA(sum((y) => y.credit.reglees)), `${sum((y) => y.credit.n)} ligne(s) crédit`],
          ["Décaissé (fournisseurs réglés)", formatDA(sum((y) => y.debit.reglees)), `${sum((y) => y.debit.n)} ligne(s) débit`],
          ["Créances en attente", formatDA(sum((y) => y.credit.attente)), `${sum((y) => y.credit.nAttente)} facture(s) partenaire`],
          ["Dettes en attente", formatDA(sum((y) => y.debit.attente)), `${sum((y) => y.debit.nAttente)} facture(s) fournisseur`],
        ].map(([label, value, hint]) => (
          <Card key={label} className="p-4">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="font-semibold tabular-nums">{value}</p>
            <p className="text-xs text-muted-foreground">{hint}</p>
          </Card>
        ))}
      </div>
      <div className="mb-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Créances en attente {annee ?? "2023 – 2025"}</CardTitle>
            <CardDescription>Montant restant à encaisser, par partenaire</CardDescription>
          </CardHeader>
          <CardContent>
            <DonutChart slices={data.pending} centerLabel="À encaisser" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Année par année</CardTitle>
            <CardDescription>Réglé et en attente, crédit et débit</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Année</TableHead>
                  <TableHead className="text-right">Encaissé</TableHead>
                  <TableHead className="text-right">Décaissé</TableHead>
                  <TableHead className="text-right">Créance en attente</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.years.map((year) => (
                  <TableRow key={year.annee}>
                    <TableCell>
                      <Link href={href({ annee: year.annee })} className="font-medium hover:underline">
                        {year.annee}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatDA(year.credit.reglees)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatDA(year.debit.reglees)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatDA(year.credit.attente)}
                      <span className="block text-xs text-muted-foreground">{year.credit.nAttente} facture(s)</span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
      <form method="get" className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-4" role="search">
        {annee ? <input type="hidden" name="annee" value={annee} /> : null}
        <Input name="q" defaultValue={parsed.q ?? ""} placeholder="Libellé, tiers, n° de facture…" aria-label="Recherche" className="sm:col-span-2" />
        <NativeSelect name="sens" defaultValue={parsed.sens ?? ""} aria-label="Sens">
          <option value="">Crédit et débit</option>
          <option value="CREDIT">Crédit</option>
          <option value="DEBIT">Débit</option>
        </NativeSelect>
        <NativeSelect name="status" defaultValue={parsed.status ?? ""} aria-label="État">
          <option value="">Tous les états</option>
          <option value="EN_ATTENTE">En attente</option>
          <option value="REGLE">Réglé</option>
          <option value="ANNULE">Annulé</option>
        </NativeSelect>
        <div className="sm:col-span-4 sm:text-right">
          <Button type="submit">Filtrer</Button>
        </div>
      </form>
      <p className="mb-2 text-sm text-muted-foreground">
        {data.total.toLocaleString("fr-FR")} ligne(s) · total {formatDA(data.sum)}
      </p>
      {data.items.length === 0 ? (
        <StateMessage kind="empty" title="Aucune ligne ne correspond" message="Modifiez les filtres ou la recherche." />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Banque</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Montant (DA)</TableHead>
                  <TableHead>N° facture</TableHead>
                  <TableHead>N° chèque</TableHead>
                  <TableHead>Libellé</TableHead>
                  <TableHead>Motif / détail</TableHead>
                  <TableHead>D / C</TableHead>
                  <TableHead>État</TableHead>
                  <TableHead>Commentaire</TableHead>
                  <TableHead className="text-right">Classe</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((line) => (
                  <TableRow key={line.id}>
                    <TableCell className="whitespace-nowrap tabular-nums">{formatDate(line.dateOperation ?? line.dateFacture)}</TableCell>
                    <TableCell>{line.banque || "—"}</TableCell>
                    <TableCell className="whitespace-nowrap">{line.mode ? MODE_LABELS[line.mode] : "—"}</TableCell>
                    <TableCell className="whitespace-nowrap text-right font-semibold tabular-nums">{formatDA(line.montant)}</TableCell>
                    <TableCell className="whitespace-nowrap">{line.numero || "—"}</TableCell>
                    <TableCell className="whitespace-nowrap">{line.cheque || "—"}</TableCell>
                    <TableCell className="max-w-56">
                      <Link href={`/factures/${line.id}`} className="block truncate font-medium hover:underline" title={line.tiers}>
                        {line.tiers}
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-64">
                      <span className="block truncate text-sm text-muted-foreground" title={line.libelle}>
                        {line.libelle || "—"}
                      </span>
                    </TableCell>
                    <TableCell>{line.sens === "CREDIT" ? "Crédit" : "Débit"}</TableCell>
                    <TableCell>
                      <StatusBadge status={line.status} />
                    </TableCell>
                    <TableCell className="max-w-44">
                      <span className="block truncate text-sm" title={line.categorie}>
                        {line.categorie || "—"}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{line.classe ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pagination page={data.page} pageCount={data.pageCount} hrefFor={(page) => href({ page })} />
        </>
      )}
    </>
  );
}
