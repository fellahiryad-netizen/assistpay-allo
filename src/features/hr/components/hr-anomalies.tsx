"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { AlertTriangle } from "lucide-react";
import {
  deleteHrEntryAction,
  restoreHrAnomalyAction,
  validateHrAnomalyAction,
} from "@/app/actions/hr-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { HrEntryDialog } from "@/features/hr/components/hr-entry-dialog";
import type {
  HrAnomalyDTO,
  HrEntryDTO,
  HrValidatedAnomalyDTO,
} from "@/features/hr/types";
import { formatDA, formatDate, formatDateTime } from "@/utils/format";

/** Propriétés de l'encadré des anomalies RH (données sérialisables uniquement). */
export interface HrAnomaliesProps {
  anomalies: HrAnomalyDTO[];
  validated: HrValidatedAnomalyDTO[];
  /** Nombre total d'anomalies à traiter (peut dépasser le nombre affiché). */
  total: number;
  /** Adresse qui affiche toutes les anomalies, ou null si tout est déjà affiché. */
  showAllHref: string | null;
  canEdit: boolean;
  beneficiaries: string[];
  today: string;
}

const KIND_LABELS = {
  doublon: "Doublon",
  beneficiaire: "Bénéficiaire",
  periode: "Période",
} as const;

/** Action en cours de confirmation : validation d'une anomalie (avec motif) ou suppression d'une écriture. */
type Pending =
  | { type: "valider"; key: string }
  | { type: "supprimer"; key: string; entryId: string }
  | null;

const describeEntry = (entry: HrEntryDTO): string =>
  `${entry.date ? `du ${formatDate(entry.date)}` : "sans date"}, ${entry.nature} – ${entry.beneficiaire || "sans bénéficiaire"}, ${formatDA(entry.montant)}${entry.cheque ? `, chèque ${entry.cheque}` : ""}`;

/**
 * Encadré des anomalies RH : pour chaque anomalie, corriger l'écriture (fenêtre de saisie existante), supprimer une des écritures d'un doublon
 * (après confirmation) ou valider l'anomalie (« vérifiée, c'est normal »). Les anomalies validées restent consultables et rétablissables.
 */
export function HrAnomalies({
  anomalies,
  validated,
  total,
  showAllHref,
  canEdit,
  beneficiaries,
  today,
}: Readonly<HrAnomaliesProps>): React.JSX.Element | null {
  const [action, setAction] = useState<Pending>(null);
  const [motif, setMotif] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (total === 0 && validated.length === 0) return null;

  function run(
    task: () => Promise<{ success: true } | { success: false; error: string }>,
  ): void {
    setError(null);
    startTransition(async () => {
      const result = await task();
      if (result.success) {
        setAction(null);
        setMotif("");
      } else {
        setError(result.error);
      }
    });
  }

  const open = (next: Pending): void => {
    setError(null);
    setMotif("");
    setAction(next);
  };

  return (
    <Card className="mb-4 border-warning/40 p-4">
      <h2 className="flex items-center gap-2 text-base font-semibold">
        <AlertTriangle className="size-4 text-warning" aria-hidden />
        Anomalies ({total})
      </h2>
      <p className="mb-2 text-xs text-muted-foreground">
        Indications à vérifier : rien n'est modifié automatiquement. Corrigez
        l'écriture, supprimez le doublon, ou validez l'anomalie si elle est
        normale.
      </p>
      {error ? (
        <p
          role="alert"
          className="mb-2 rounded-md bg-destructive/10 p-2 text-sm text-destructive"
        >
          {error}
        </p>
      ) : null}
      {total === 0 ? (
        <p className="text-sm text-muted-foreground">
          Aucune anomalie à traiter.
        </p>
      ) : null}
      <ul className="space-y-3 text-sm">
        {anomalies.map((anomaly) => {
          const target =
            action?.type === "supprimer" && action.key === anomaly.key
              ? anomaly.entries.find((entry) => entry.id === action.entryId)
              : undefined;
          return (
            <li key={anomaly.key} className="rounded-md border p-2">
              <div className="flex flex-wrap items-start gap-2">
                <Badge
                  variant={
                    anomaly.level === "certain" ? "destructive" : "warning"
                  }
                >
                  {KIND_LABELS[anomaly.kind]}
                </Badge>
                <span className="min-w-0 flex-1">{anomaly.message}</span>
              </div>
              {canEdit ? (
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
                  {anomaly.entries.map((entry, index) => (
                    <span
                      key={entry.id}
                      className="flex flex-wrap items-center gap-2 text-xs"
                    >
                      <span className="text-muted-foreground">
                        {anomaly.entries.length > 1
                          ? `Écriture ${index + 1} :`
                          : "Écriture :"}
                      </span>
                      <HrEntryDialog
                        entry={entry}
                        beneficiaries={beneficiaries}
                        today={today}
                        triggerLabel="Corriger"
                      />
                      {anomaly.kind === "doublon" ? (
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() =>
                            open({
                              type: "supprimer",
                              key: anomaly.key,
                              entryId: entry.id,
                            })
                          }
                          className="font-medium text-destructive hover:underline disabled:opacity-50"
                        >
                          Supprimer
                        </button>
                      ) : null}
                    </span>
                  ))}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() => open({ type: "valider", key: anomaly.key })}
                  >
                    Valider
                  </Button>
                </div>
              ) : null}
              {action?.key === anomaly.key && action.type === "valider" ? (
                <form
                  className="mt-2 flex flex-wrap items-center gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    run(() =>
                      validateHrAnomalyAction({ key: anomaly.key, motif }),
                    );
                  }}
                >
                  <Input
                    value={motif}
                    onChange={(event) => setMotif(event.target.value)}
                    maxLength={200}
                    placeholder="Motif (facultatif) : vérifié, c'est normal parce que…"
                    aria-label="Motif de la validation"
                    className="max-w-md"
                  />
                  <Button type="submit" size="sm" disabled={pending}>
                    {pending ? "Validation…" : "Confirmer la validation"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() => setAction(null)}
                  >
                    Annuler
                  </Button>
                </form>
              ) : null}
              {action?.type === "supprimer" && target ? (
                <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md bg-destructive/10 p-2">
                  <span className="min-w-0 flex-1 text-destructive">
                    Supprimer définitivement l'écriture {describeEntry(target)}{" "}
                    ? Les totaux mensuels seront recalculés.
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    disabled={pending}
                    onClick={() =>
                      run(() => deleteHrEntryAction({ id: action.entryId }))
                    }
                  >
                    {pending ? "Suppression…" : "Confirmer la suppression"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() => setAction(null)}
                  >
                    Annuler
                  </Button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {showAllHref && total > anomalies.length ? (
        <p className="mt-2 text-sm">
          {anomalies.length} anomalie(s) affichée(s) sur {total}.{" "}
          <Link
            href={showAllHref}
            className="font-medium text-primary hover:underline"
          >
            Afficher tout
          </Link>
        </p>
      ) : null}
      {validated.length > 0 ? (
        <details className="mt-3 border-t pt-2">
          <summary className="cursor-pointer text-sm font-medium">
            Anomalies validées ({validated.length})
          </summary>
          <ul className="mt-2 space-y-2 text-sm">
            {validated.map((item) => (
              <li key={item.key} className="flex flex-wrap items-start gap-2">
                <Badge variant="muted">{KIND_LABELS[item.kind]}</Badge>
                <div className="min-w-0 flex-1">
                  <p>{item.message}</p>
                  <p className="text-xs text-muted-foreground">
                    Validée par {item.par || "—"}
                    {item.le ? ` le ${formatDateTime(item.le)}` : ""}
                    {item.motif ? ` – motif : ${item.motif}` : ""}
                  </p>
                </div>
                {canEdit ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() =>
                      run(() => restoreHrAnomalyAction({ key: item.key }))
                    }
                  >
                    Rétablir
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </Card>
  );
}
