import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/common/page-header";
import { StateMessage } from "@/components/common/state-message";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ReminderButton } from "@/features/partners/components/reminder-button";
import { partnerQuerySchema } from "@/features/partners/schemas";
import { partnerDetail } from "@/features/partners/services/partner-service";
import { cn } from "@/utils/cn";
import { formatDA, formatDate, formatDateTime } from "@/utils/format";

export const metadata: Metadata = { title: "Fiche partenaire" };

/** Fiche partenaire : succursales, factures, relances, relevé de compte. */
export default async function PartnerPage({
  params,
  searchParams,
}: Readonly<{ params: Promise<{ cle: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }>): Promise<React.JSX.Element> {
  const user = await requireUser();
  const { cle } = await params;
  const raw = await searchParams;
  const one = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value) || undefined;
  const parsed = partnerQuerySchema.safeParse({ key: decodeURIComponent(cle), succ: one(raw.succ) ?? "", seuil: one(raw.seuil), annee: one(raw.annee) });
  if (!parsed.success) notFound();
  const query = parsed.data;
  const result = await partnerDetail(user, query);
  if (!result.success) {
    if (result.code === "NOT_FOUND") notFound();
    return <StateMessage kind={result.code === "FORBIDDEN" ? "forbidden" : "error"} title="Fiche indisponible" message={result.error} />;
  }
  const data = result.data;
  const link = (patch: Record<string, string>): string => {
    const search = new URLSearchParams({ annee: String(query.annee), seuil: String(query.seuil), ...(query.succ ? { succ: query.succ } : {}), ...patch });
    return `/partenaires/${encodeURIComponent(query.key)}?${search.toString()}`;
  };
  return (
    <>
      <PageHeader
        title={`Fiche ${query.key}`}
        description={`Solde dû ${formatDA(data.stats.balance)} · ${data.stats.pending} facture(s) en attente · délai médian ${data.stats.medianDelay !== null ? `${data.stats.medianDelay} j` : "—"}`}
        actions={
          <Link href="/partenaires" className={buttonVariants({ variant: "ghost" })}>
            <ArrowLeft />
            Partenaires
          </Link>
        }
      />
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <form method="get" className="flex gap-2">
          <input type="hidden" name="annee" value={String(query.annee)} />
          {query.succ ? <input type="hidden" name="succ" value={query.succ} /> : null}
          <NativeSelect name="seuil" defaultValue={String(query.seuil)} aria-label="Seuil de retard">
            {[30, 60, 90, 120].map((value) => (
              <option key={value} value={value}>
                Retard &gt; {value} j
              </option>
            ))}
          </NativeSelect>
          <Button type="submit" variant="outline">
            Appliquer
          </Button>
        </form>
        <div className="flex flex-wrap gap-2 sm:ml-auto">
          {data.canEdit ? <ReminderButton partner={query.key} branch={query.succ} threshold={query.seuil} /> : null}
          <a href={`/api/partenaires/releve?${new URLSearchParams({ key: query.key, succ: query.succ }).toString()}`} className={buttonVariants({ variant: "outline" })}>
            <Download />
            Relevé de compte (Excel)
          </a>
        </div>
      </div>
      {data.branches.length > 1 ? (
        <Card className="mb-5 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Succursale / agence</TableHead>
                <TableHead className="text-right">Facturé</TableHead>
                <TableHead className="text-right">Encaissé</TableHead>
                <TableHead className="text-right">Solde dû</TableHead>
                <TableHead className="text-right">En attente</TableHead>
                <TableHead className="text-right">Délai médian</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.branches.map((branch) => (
                <TableRow key={branch.name} className={cn(query.succ === branch.name && "bg-primary/5")}>
                  <TableCell>
                    <Link href={link({ succ: query.succ === branch.name ? "" : branch.name })} className="font-medium hover:underline">
                      {branch.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatDA(branch.invoiced)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatDA(branch.collected)}</TableCell>
                  <TableCell className={cn("text-right tabular-nums", branch.balance > 0 && "text-destructive")}>{formatDA(branch.balance)}</TableCell>
                  <TableCell className="text-right tabular-nums">{branch.pending}</TableCell>
                  <TableCell className="text-right tabular-nums">{branch.medianDelay !== null ? `${branch.medianDelay} j` : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      ) : null}
      <h2 className="mb-2 text-lg font-semibold">
        {query.succ ? `${query.succ} – ` : ""}Factures ({data.invoices.length})
      </h2>
      <div className="mb-6 rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>N° facture</TableHead>
              <TableHead className="hidden lg:table-cell">Libellé</TableHead>
              <TableHead>Date facture</TableHead>
              <TableHead className="text-right">Montant</TableHead>
              <TableHead className="text-right">Reste dû</TableHead>
              <TableHead>Règlement</TableHead>
              <TableHead className="text-right">Délai / ancienneté</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.invoices.map((invoice) => (
              <TableRow key={invoice.id}>
                <TableCell className="whitespace-nowrap">
                  <Link href={`/factures/${invoice.id}`} className="font-medium hover:underline">
                    {invoice.numero || "—"}
                  </Link>
                  <span className="block text-xs text-muted-foreground">{invoice.succursale}</span>
                </TableCell>
                <TableCell className="hidden max-w-80 truncate lg:table-cell">{invoice.libelle}</TableCell>
                <TableCell className="whitespace-nowrap tabular-nums">
                  {invoice.factureDate ? `${formatDate(invoice.factureDate)}${invoice.estimated ? " (est.)" : ""}` : "—"}
                </TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums">{formatDA(invoice.montant)}</TableCell>
                <TableCell className={cn("whitespace-nowrap text-right tabular-nums", invoice.remaining > 0 && "text-destructive")}>{invoice.remaining > 0 ? formatDA(invoice.remaining) : "—"}</TableCell>
                <TableCell className="whitespace-nowrap">
                  {invoice.status === "REGLE" ? (
                    <span className="text-sm">{formatDate(invoice.dateOperation)}</span>
                  ) : (
                    <Badge variant={invoice.status === "PARTIEL" ? "accent" : "warning"}>{invoice.status === "PARTIEL" ? "Partiel" : "En attente"}</Badge>
                  )}
                </TableCell>
                <TableCell className={cn("whitespace-nowrap text-right tabular-nums", invoice.ageDays !== null && invoice.ageDays > query.seuil && "font-semibold text-destructive")}>
                  {invoice.delayDays !== null ? `${invoice.delayDays} j` : invoice.ageDays !== null ? `${invoice.ageDays} j` : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <h2 className="mb-2 text-lg font-semibold">Relances envoyées ({data.reminders.length})</h2>
      {data.reminders.length ? (
        <ul className="flex flex-col gap-1 text-sm">
          {data.reminders.map((reminder) => (
            <li key={reminder.id}>
              {formatDateTime(reminder.date)} – {reminder.succursale || "toutes succursales"} – {reminder.nb} facture(s), {formatDA(reminder.montant)}
              {reminder.by ? ` – par ${reminder.by}` : ""}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Aucune relance enregistrée.</p>
      )}
    </>
  );
}
