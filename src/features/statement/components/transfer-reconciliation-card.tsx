"use client";

import { useState, useTransition } from "react";
import { CheckCheck, Link2, X } from "lucide-react";
import { applyTransferAction, linkExistingAction, refuseTransferAction } from "@/app/actions/statement-actions";
import { Notice } from "@/components/common/notice";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { TransferReconciliation } from "@/features/statement/types/double-entry";
import { formatDA, formatDate } from "@/utils/format";

/** Propriétés de la carte de rapprochement d'un envoi. */
export interface TransferReconciliationCardProps {
  item: TransferReconciliation;
  canEdit: boolean;
}

/** Débit global du relevé ↔ détail de l'envoi de virements, prestataire par prestataire. */
export function TransferReconciliationCard({ item, canEdit }: Readonly<TransferReconciliationCardProps>): React.JSX.Element {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const found = item.beneficiaries.filter((beneficiary) => beneficiary.invoices.length > 0).length;
  const missing = item.beneficiaries.length - found;

  function run(action: () => Promise<{ success: true; data: string } | { success: false; error: string }>): void {
    startTransition(async () => {
      const outcome = await action();
      setResult(outcome.success ? { tone: "success", text: outcome.data } : { tone: "error", text: outcome.error });
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">
          Relevé du {formatDate(item.date)} · {formatDA(item.montant)} · {item.libelle}
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          = envoi « {item.batch.ref} » ({item.batch.produit}, {item.batch.mois}
          {item.batch.annee ? ` ${item.batch.annee}` : ""}) : {item.batch.nb} virements vers {item.beneficiaries.length} prestataires · {found} retrouvé(s) au Débit,{" "}
          {missing} sans facture saisie (une ligne sera créée).
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {item.existing.length ? (
          <Notice tone="warning">
            Ce paiement est peut-être déjà enregistré au Débit :{" "}
            {item.existing.map((row) => `${formatDate(row.date)} · ${row.label} · ${formatDA(row.montant)}`).join(" ; ")}. Rapprochez-le de cette ligne pour ne rien créer en
            double.
          </Notice>
        ) : null}
        <details open={item.beneficiaries.length <= 8}>
          <summary className="cursor-pointer text-sm font-medium">Détail des {item.beneficiaries.length} prestataires de l&apos;envoi</summary>
          <div className="mt-2 overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/60 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Prestataire (fichier banque)</th>
                  <th className="px-3 py-2 text-right">Virement</th>
                  <th className="px-3 py-2 text-left">Facture(s) au Débit</th>
                </tr>
              </thead>
              <tbody>
                {item.beneficiaries.map((beneficiary) => (
                  <tr key={`${beneficiary.nom}-${beneficiary.montant}`} className="border-t">
                    <td className="px-3 py-2">
                      {beneficiary.nom}
                      {beneficiary.count > 1 ? ` (${beneficiary.count} virements)` : ""}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatDA(beneficiary.montant)}</td>
                    <td className="px-3 py-2">
                      {beneficiary.invoices.length ? (
                        beneficiary.invoices.map((invoice) => invoice.label).join(" + ")
                      ) : (
                        <span className="text-warning">
                          {beneficiary.otherCandidates ? `${beneficiary.otherCandidates} facture(s) de ce prestataire mais montant différent : ligne créée` : "aucune facture saisie : ligne créée"}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
        {result ? <Notice tone={result.tone}>{result.text}</Notice> : null}
        {canEdit && !result?.tone.startsWith("success") ? (
          <div className="flex flex-wrap gap-2">
            {item.existing.slice(0, 3).map((row) => (
              <Button
                key={row.id}
                type="button"
                size="sm"
                disabled={pending}
                onClick={() =>
                  run(async () => {
                    const outcome = await linkExistingAction({ lineId: item.lineId, invoiceId: row.id });
                    return outcome.success ? { success: true, data: "Débit rapproché de la ligne existante : rien n'a été créé." } : outcome;
                  })
                }
              >
                <Link2 />
                Rapprocher avec la ligne existante ({formatDA(row.montant)})
              </Button>
            ))}
            <Button
              type="button"
              size="sm"
              variant={item.existing.length ? "outline" : "default"}
              disabled={pending}
              onClick={() =>
                run(async () => {
                  const outcome = await applyTransferAction({ lineId: item.lineId, batchId: item.batch.id });
                  return outcome.success
                    ? { success: true, data: `${outcome.data.found} facture(s) prestataire réglée(s), ${outcome.data.created} ligne(s) créée(s). Aucun montant global au Débit.` }
                    : outcome;
                })
              }
            >
              <CheckCheck />
              {item.existing.length ? "Détailler quand même" : "Rapprocher le détail"} ({item.beneficiaries.length} prestataires)
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() =>
                run(async () => {
                  const outcome = await refuseTransferAction({ lineId: item.lineId, batchId: item.batch.id });
                  return outcome.success ? { success: true, data: `Noté : ce débit n'est pas l'envoi « ${item.batch.ref} ».` } : outcome;
                })
              }
            >
              <X />
              C&apos;est un autre virement
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
