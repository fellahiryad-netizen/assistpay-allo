import type { Metadata } from "next";
import Link from "next/link";
import { FileText } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/common/page-header";
import { StateMessage } from "@/components/common/state-message";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CopyMessage } from "@/features/caar/components/copy-message";
import { getProduction } from "@/features/caar/services/caar-service";
import { formatDA, formatDate } from "@/utils/format";

export const metadata: Metadata = { title: "Production CAAR" };

/** Détail d'une production CAAR contrôlée. */
export default async function CaarDetailPage({ params }: Readonly<{ params: Promise<{ id: string }> }>): Promise<React.JSX.Element> {
  const user = await requireUser();
  const { id } = await params;
  const result = await getProduction(user, id);
  if (!result.success) return <StateMessage kind={result.code === "FORBIDDEN" ? "forbidden" : result.code === "NOT_FOUND" ? "empty" : "error"} title="Production introuvable" message={result.error} />;
  const p = result.data;
  return (
    <>
      <PageHeader
        title={`CAAR ${p.succursale} — ${p.periodLabel}`}
        description={`Fichier « ${p.fichier} » · ${p.totals.n} polices retenues`}
        actions={
          p.invoice ? (
            <Badge variant="success">
              Facturée : N° {p.invoice.num} du {formatDate(p.invoice.date)} · {formatDA(p.invoice.ttc)}
            </Badge>
          ) : p.canBill ? (
            <Link href={`/facturation/nouvelle?caar=${p.id}`} className={buttonVariants()}>
              <FileText />
              Facturer
            </Link>
          ) : null
        }
      />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {(
          [
            ["Prime nette", p.totals.prime],
            ["Part ALLO 47 %", p.totals.allo],
            ["Avance 90 % HT", p.totals.av],
            ["TVA 19 %", p.totals.tva],
            ["TTC à facturer", p.totals.ttc],
          ] as const
        ).map(([label, value]) => (
          <Card key={label} className="p-3">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-lg font-semibold tabular-nums">{formatDA(value)}</p>
          </Card>
        ))}
      </div>
      {p.checks.map((check) => {
        const gap = Math.round((check.ours - check.declared) * 100) / 100;
        return (
          <p key={check.label} className={Math.abs(gap) < 1 ? "mt-3 text-sm text-success" : "mt-3 text-sm text-destructive"}>
            {check.label} déclarée : {formatDA(check.declared)} ({check.src}) — {Math.abs(gap) < 1 ? "identique au total recalculé." : `écart de ${formatDA(gap)} avec le total recalculé.`}
          </p>
        );
      })}
      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <section>
          <h2 className="mb-2 text-lg font-semibold">TCD par agence</h2>
          <div className="max-h-96 overflow-auto rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Agence</TableHead>
                  <TableHead className="text-right">Polices</TableHead>
                  <TableHead className="text-right">Prime nette</TableHead>
                  <TableHead className="text-right">Part ALLO 47 %</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {p.tcd.map(([agence, n, prime]) => (
                  <TableRow key={agence}>
                    <TableCell>{agence}</TableCell>
                    <TableCell className="text-right tabular-nums">{n}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatDA(prime)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatDA(Math.round(prime * 47) / 100)}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="font-semibold">
                  <TableCell>Total</TableCell>
                  <TableCell className="text-right tabular-nums">{p.totals.n}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatDA(p.totals.prime)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatDA(p.totals.allo)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </section>
        <section className="flex flex-col gap-6">
          {p.products.length ? (
            <div>
              <h2 className="mb-2 text-lg font-semibold">Répartition par formule</h2>
              <div className="rounded-lg border bg-card">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Formule</TableHead>
                      <TableHead className="text-right">Polices</TableHead>
                      <TableHead className="text-right">Prime</TableHead>
                      <TableHead className="text-right">Hors barème</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {p.products.map(([code, label, n, prime, ko]) => (
                      <TableRow key={code}>
                        <TableCell>{label}</TableCell>
                        <TableCell className="text-right tabular-nums">{n}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatDA(prime)}</TableCell>
                        <TableCell className="text-right tabular-nums">{ko || "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          ) : null}
          <div>
            <h2 className="mb-2 text-lg font-semibold">Points relevés</h2>
            {p.kinds.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucune anomalie.</p>
            ) : (
              <ul className="flex flex-col gap-1.5 text-sm">
                {p.kinds.map((kind) => (
                  <li key={kind.flag} className="flex items-center justify-between gap-2">
                    <span>{kind.label}</span>
                    <Badge variant={kind.severity === "err" ? "destructive" : kind.severity === "warn" ? "warning" : "muted"}>{kind.count}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {p.message ? (
            <div>
              <h2 className="mb-2 text-lg font-semibold">Message à la succursale</h2>
              <CopyMessage message={p.message} />
            </div>
          ) : null}
        </section>
      </div>
      {p.anomalyLines.length ? (
        <section className="mt-6">
          <h2 className="mb-2 text-lg font-semibold">Lignes à faire corriger ({p.anomalyLines.length})</h2>
          <div className="max-h-96 overflow-auto rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ligne</TableHead>
                  <TableHead>Agence</TableHead>
                  <TableHead>Police</TableHead>
                  <TableHead>Assuré</TableHead>
                  <TableHead className="text-right">Prime</TableHead>
                  <TableHead>Motif</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {p.anomalyLines.map((line) => (
                  <TableRow key={line.line}>
                    <TableCell className="tabular-nums">{line.line}</TableCell>
                    <TableCell>{line.agence || "—"}</TableCell>
                    <TableCell>{line.police || "—"}</TableCell>
                    <TableCell className="max-w-48 truncate">{line.nom || "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{line.prime === null ? "—" : formatDA(line.prime)}</TableCell>
                    <TableCell className="text-xs">
                      {line.flags.join(", ")}
                      {line.basis ? <span className="block text-muted-foreground">{line.basis}</span> : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      ) : null}
    </>
  );
}
