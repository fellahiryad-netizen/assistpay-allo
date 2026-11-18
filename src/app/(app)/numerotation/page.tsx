import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { Notice } from "@/components/common/notice";
import { PageHeader } from "@/components/common/page-header";
import { StateMessage } from "@/components/common/state-message";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getNumberingRegistry } from "@/features/numbering/services/numbering-service";
import type { DeletionInfo, FreedStatus, GapRange, SeriesSummary } from "@/features/numbering/types";
import { cn } from "@/utils/cn";
import { todayIso } from "@/utils/dates";
import { formatDateTime } from "@/utils/format";

export const metadata: Metadata = { title: "Registre de numérotation" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const STATUS_LABELS: Readonly<Record<FreedStatus, { label: string; variant: "success" | "warning" | "destructive" }>> = {
  libre_reprise: { label: "Libre : sera redonné automatiquement", variant: "warning" },
  libre_trou: { label: "Libre : trou définitif", variant: "destructive" },
  reutilise: { label: "Déjà réutilisé", variant: "success" },
};

const ORIGIN_LABELS: Readonly<Record<DeletionInfo["origin"], string>> = {
  journal: "Journal",
  demande: "Demande validée",
  rectification: "Rectification",
};

function rangeText(range: GapRange): string {
  return range.from === range.to ? range.fromDisplay : `${range.fromDisplay} → ${range.toDisplay}`;
}

function explainedCount(item: SeriesSummary): number {
  return item.gapCount - item.unexplainedGapCount - item.beforeFirstGapCount;
}

function SeriesCard({ item }: Readonly<{ item: SeriesSummary }>): React.JSX.Element {
  const unexplained = item.gaps.filter((range) => !range.explained);
  const explained = item.gaps.filter((range) => range.explained);
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {item.label} · {item.year}
        </CardTitle>
        <CardDescription>
          Dernier numéro : <strong className="text-foreground">{item.lastDisplay}</strong> · {item.count} numéro{item.count > 1 ? "s" : ""} sur {item.documents} document{item.documents > 1 ? "s" : ""} · prochain proposé aujourd'hui : {item.nextDisplay}
        </CardDescription>
        <div className="flex flex-wrap gap-2 pt-1">
          <Badge variant={item.duplicates.length ? "destructive" : "success"}>{item.duplicates.length} doublon{item.duplicates.length > 1 ? "s" : ""}</Badge>
          <Badge variant={item.unexplainedGapCount ? "warning" : "success"}>{item.unexplainedGapCount} trou{item.unexplainedGapCount > 1 ? "s" : ""} à expliquer</Badge>
          {item.beforeFirstGapCount ? <Badge variant="muted">{item.beforeFirstGapCount} n° avant le premier enregistré (historique)</Badge> : null}
          <Badge variant="muted">{explainedCount(item)} trou{explainedCount(item) > 1 ? "s" : ""} expliqué{explainedCount(item) > 1 ? "s" : ""} par une suppression</Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {item.duplicates.length ? (
          <section>
            <h3 className="mb-2 text-sm font-semibold text-destructive">Doublons : un même numéro porté par plusieurs factures</h3>
            <ul className="divide-y rounded-md border text-sm">
              {item.duplicates.map((dup) => (
                <li key={dup.seq} className="px-3 py-2">
                  <span className="font-medium">{dup.display}</span>
                  <span className="block text-xs text-muted-foreground">{dup.docs.map((doc) => `${doc.raw} · ${doc.label}`).join("  |  ")}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {item.gaps.length ? (
          <section>
            <h3 className="mb-2 text-sm font-semibold">Trous dans la suite</h3>
            <ul className="flex flex-wrap gap-2 text-xs">
              {unexplained.map((range) => (
                <li key={`u${range.from}`} className={cn("rounded-md border px-2 py-1 tabular-nums", range.beforeFirst ? "bg-muted text-muted-foreground" : "border-warning/50 bg-warning/10")}>
                  {rangeText(range)} · {range.count} n°{range.beforeFirst ? " (avant le premier n° enregistré)" : ""}
                </li>
              ))}
              {explained.map((range) => (
                <li key={`e${range.from}`} className="rounded-md border bg-muted px-2 py-1 tabular-nums text-muted-foreground">
                  {rangeText(range)} · supprimé{range.count > 1 ? "s" : ""}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {item.freed.length ? (
          <section>
            <h3 className="mb-2 text-sm font-semibold">Numéros issus de factures supprimées ou remplacées</h3>
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Numéro</TableHead>
                    <TableHead>Situation</TableHead>
                    <TableHead>Quand, par qui</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Motif</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {item.freed.map((entry) => {
                    const status = STATUS_LABELS[entry.status];
                    return (
                      <TableRow key={entry.seq}>
                        <TableCell className="whitespace-nowrap font-medium tabular-nums">{entry.display}</TableCell>
                        <TableCell>
                          <Badge variant={status.variant}>{status.label}</Badge>
                        </TableCell>
                        <TableCell className="text-sm">
                          {entry.deletion.at ? formatDateTime(entry.deletion.at) : "date inconnue"}
                          {entry.deletion.by ? <span className="block text-xs text-muted-foreground">{entry.deletion.by}</span> : null}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{ORIGIN_LABELS[entry.deletion.origin]}</TableCell>
                        <TableCell className="max-w-64 text-sm text-muted-foreground">{entry.deletion.motif ?? "—"}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </section>
        ) : null}
        {item.partners.length ? (
          <section>
            <h3 className="mb-2 text-sm font-semibold">Par partenaire (préfixe du numéro)</h3>
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Préfixe</TableHead>
                    <TableHead className="text-right">Numéros</TableHead>
                    <TableHead>Dernier numéro</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {item.partners.map((partner) => (
                    <TableRow key={partner.prefix}>
                      <TableCell className="font-medium">{partner.prefix}</TableCell>
                      <TableCell className="text-right tabular-nums">{partner.count}</TableCell>
                      <TableCell className="tabular-nums">{partner.lastDisplay}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </section>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** Registre de numérotation (consultation seule) : séries, trous, doublons et numéros de factures supprimées. */
export default async function NumberingPage({ searchParams }: Readonly<{ searchParams: SearchParams }>): Promise<React.JSX.Element> {
  const user = await requireUser();
  const result = await getNumberingRegistry(user);
  if (!result.success) return <StateMessage kind={result.code === "FORBIDDEN" ? "forbidden" : "error"} title="Registre indisponible" message={result.error} />;
  const raw = (await searchParams).annee;
  const param = Array.isArray(raw) ? raw[0] : raw;
  const currentYear = Number(todayIso().slice(0, 4));
  const wanted = param === "toutes" ? null : Number(param) || currentYear;
  const { series, years, totals, unrecognised } = result.data;
  const shown = wanted === null ? series : series.filter((item) => item.year === wanted);
  const choices: Array<{ href: string; label: string; active: boolean }> = [
    ...years.map((year) => ({ href: `/numerotation?annee=${year}`, label: String(year), active: wanted === year })),
    { href: "/numerotation?annee=toutes", label: "Toutes les années", active: wanted === null },
  ];
  return (
    <>
      <PageHeader title="Registre de numérotation" description="Pour chaque série (type de facture et année) : dernier numéro, trous, doublons et numéros libérés par une suppression. Page de consultation : rien n'est modifié." />
      <Notice tone="info" className="mb-4">
        La suite des factures partenaires (GAM, TRUST, CAAT, CAAR, MLA, TDA…) est commune : un trou n'est donc pas propre à un partenaire. Les séries BDG (GAM « AB », TRUST, CAAT) et les avoirs ont chacune leur suite.
      </Notice>
      <Notice tone="warning" className="mb-4">
        Le compteur de doublons peut inclure de faux doublons : quand une facture établie n'est pas reliée à sa ligne du suivi (et que le rapprochement par numéro et client n'est pas possible), les deux sont comptées comme deux documents. Vérifiez chaque doublon avant d'en tirer une conclusion.
        {user.isAdmin ? null : " L'auteur et le motif des suppressions ne sont visibles que par les administrateurs."}
      </Notice>
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        {choices.map((choice) => (
          <Link key={choice.href} href={choice.href} className={cn("rounded-md border px-3 py-1", choice.active ? "bg-primary text-primary-foreground" : "bg-card hover:bg-muted")}>
            {choice.label}
          </Link>
        ))}
        <span className="text-muted-foreground">
          · {totals.series} série{totals.series > 1 ? "s" : ""}, {totals.duplicates} doublon{totals.duplicates > 1 ? "s" : ""}, {totals.unexplainedGaps} trou{totals.unexplainedGaps > 1 ? "s" : ""} à expliquer{totals.beforeFirstGaps ? ` (+ ${totals.beforeFirstGaps} n° d'historique avant le premier enregistré)` : ""}, {totals.freed} numéro{totals.freed > 1 ? "s" : ""} libre{totals.freed > 1 ? "s" : ""}
        </span>
      </div>
      {shown.length === 0 ? (
        <StateMessage kind="empty" title="Aucun numéro pour cette période" />
      ) : (
        <div className="flex flex-col gap-4">
          {shown.map((item) => (
            <SeriesCard key={item.key} item={item} />
          ))}
        </div>
      )}
      {unrecognised.length ? (
        <details className="mt-6 rounded-lg border bg-card p-4 text-sm">
          <summary className="cursor-pointer font-medium">{unrecognised.length} numéro{unrecognised.length > 1 ? "s" : ""} hors des séries connues (reprises de l'historique, formats libres)</summary>
          <ul className="mt-2 grid gap-1 text-muted-foreground sm:grid-cols-2">
            {unrecognised.slice(0, 200).map((entry, index) => (
              <li key={`${entry.raw}-${index}`} className="truncate">
                {entry.raw} · {entry.label}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </>
  );
}
