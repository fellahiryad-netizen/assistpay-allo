"use client";

import { useState, useTransition } from "react";
import { Check, Clock, Download, X } from "lucide-react";
import { decideBatchAction } from "@/app/actions/transfer-actions";
import { Notice } from "@/components/common/notice";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SeverityBadge } from "@/features/transfers/components/severity-badge";
import { formatRib } from "@/features/transfers/services/rib";
import type { TransferAnalysis, TransferBatchDTO } from "@/features/transfers/types";
import { cn } from "@/utils/cn";
import { formatDA } from "@/utils/format";

/** Propriétés du détail d'un envoi. */
export interface BatchDetailProps {
  batch: TransferBatchDTO;
  analysis: TransferAnalysis;
  canEdit: boolean;
  isAdmin: boolean;
  justGenerated: boolean;
}

const STATUS: Readonly<Record<string, string>> = { valide: "Validé", rejete: "Rejeté", attente: "En attente" };

/** Contrôle d'un envoi de virements : vérifications du fichier, lignes, décision (valider, rejeter, attente). */
export function BatchDetail({ batch, analysis, canEdit, isAdmin, justGenerated }: Readonly<BatchDetailProps>): React.JSX.Element {
  const [comment, setComment] = useState(batch.comment);
  const [filter, setFilter] = useState<"pb" | "tout">("pb");
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(
    justGenerated ? { tone: "success", text: `${batch.fichier} généré et téléchargé. Contrôlez-le ci-dessous, puis validez-le pour l'historique.` } : null,
  );
  const [pending, startTransition] = useTransition();
  const lines = filter === "pb" ? analysis.lines.filter((line) => line.severity !== "ok") : analysis.lines;

  function decide(statut: "valide" | "rejete" | "attente"): void {
    if (statut === "rejete" && !window.confirm(`Rejeter l'envoi « ${batch.ref} » ? Il restera dans l'historique comme rejeté.`)) return;
    startTransition(async () => {
      const result = await decideBatchAction({ id: batch.id, statut, comment });
      if (!result.success) {
        setMessage({ tone: "error", text: result.error });
        return;
      }
      const extra = [result.data.added ? `${result.data.added} nouveau(x) prestataire(s) ajouté(s) au référentiel` : "", result.data.changes ? `${result.data.changes} changement(s) de RIB à valider dans le référentiel` : ""]
        .filter(Boolean)
        .join(" · ");
      setMessage({ tone: "success", text: `${statut === "valide" ? "Envoi validé" : statut === "rejete" ? "Envoi rejeté" : "Envoi enregistré en attente"}${extra ? ` · ${extra}` : ""}.` });
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {[
          ["Statut", STATUS[batch.status] ?? batch.status],
          ["Produit", batch.produit],
          ["Débit (D)", formatDA(analysis.debit ?? 0)],
          ["Crédits (C)", `${formatDA(analysis.credit)} · ${analysis.credits}`],
          ["Contrôle", analysis.verdict === "ok" ? "Conforme" : analysis.verdict === "err" ? `${analysis.errors} bloquant(s)` : `${analysis.warnings} à vérifier`],
        ].map(([label, value]) => (
          <Card key={label} className="p-4">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="font-semibold tabular-nums">{value}</p>
          </Card>
        ))}
      </div>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <Card>
        <CardHeader>
          <CardTitle>Vérifications du fichier</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col gap-2">
            {analysis.checks.map((check) => (
              <li key={check.title} className="flex flex-wrap items-start gap-2 text-sm">
                <SeverityBadge severity={check.severity} />
                <span className="font-medium">{check.title}</span>
                <span className="text-muted-foreground">{check.detail}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>Lignes du fichier</CardTitle>
          <div className="flex gap-1">
            <Button type="button" size="sm" variant={filter === "pb" ? "default" : "outline"} onClick={() => setFilter("pb")}>
              À vérifier ({analysis.lines.filter((line) => line.severity !== "ok").length})
            </Button>
            <Button type="button" size="sm" variant={filter === "tout" ? "default" : "outline"} onClick={() => setFilter("tout")}>
              Toutes ({analysis.lines.length})
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {lines.length === 0 ? (
            <p className="py-6 text-center text-sm text-success">Aucune ligne à vérifier.</p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full min-w-max text-sm">
                <thead className="bg-muted/60 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-2 py-2 text-left">Ligne</th>
                    <th className="px-2 py-2 text-left">Bénéficiaire</th>
                    <th className="px-2 py-2 text-left">RIB</th>
                    <th className="px-2 py-2 text-right">Montant</th>
                    <th className="px-2 py-2 text-left">Sens</th>
                    <th className="px-2 py-2 text-left">Contrôle</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => (
                    <tr key={line.row} className={cn("border-t align-top", line.severity === "err" && "bg-destructive/5", line.severity === "warn" && "bg-warning/5")}>
                      <td className="px-2 py-2 tabular-nums">{line.row}</td>
                      <td className="px-2 py-2">
                        {line.nom} {line.prenom}
                        <span className="block text-xs text-muted-foreground">{line.adresse}</span>
                      </td>
                      <td className="px-2 py-2 font-mono text-xs">{formatRib(`${line.banque}${line.agence}${line.compte}${line.cle.padStart(2, "0")}`)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{Number.isNaN(line.montant) ? "—" : formatDA(line.montant)}</td>
                      <td className="px-2 py-2">
                        <Badge variant={line.sens === "D" ? "accent" : "muted"}>{line.sens || "?"}</Badge>
                      </td>
                      <td className="px-2 py-2">
                        <ul className="flex flex-col gap-1">
                          {line.issues.map((issue) => (
                            <li key={issue.message} className="flex items-start gap-1.5 text-xs">
                              <SeverityBadge severity={issue.severity} />
                              <span>{issue.message}</span>
                            </li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardContent className="flex flex-col gap-3 pt-4 sm:flex-row sm:items-center sm:pt-5">
          <a href={`/api/virements/${batch.id}/fichier`} className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline">
            <Download className="size-4" />
            Télécharger {batch.fichier || "le fichier"}
          </a>
          {canEdit ? (
            <>
              <Input value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Commentaire (facultatif)" aria-label="Commentaire" className="sm:ml-auto sm:max-w-xs" />
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="success" disabled={pending || analysis.verdict === "err" || (analysis.overMonthly > 0 && !isAdmin)} onClick={() => decide("valide")}>
                  <Check />
                  Valider l&apos;envoi
                </Button>
                <Button type="button" variant="outline" disabled={pending} onClick={() => decide("attente")}>
                  <Clock />
                  En attente
                </Button>
                <Button type="button" variant="ghost" disabled={pending} onClick={() => decide("rejete")}>
                  <X />
                  Rejeter
                </Button>
              </div>
            </>
          ) : null}
        </CardContent>
      </Card>
      {analysis.verdict === "err" ? <Notice tone="error">Corrigez les lignes bloquantes dans le fichier, puis déposez-le de nouveau pour le contrôler.</Notice> : null}
      {analysis.overMonthly && !isAdmin ? <Notice tone="warning">Un prestataire dépasse le seuil mensuel : seul un administrateur peut valider cet envoi.</Notice> : null}
    </div>
  );
}
