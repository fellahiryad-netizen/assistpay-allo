"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AlertTriangle } from "lucide-react";
import {
  deleteHrEntryAction,
  restoreHrAnomalyAction,
  validateHrAnomaliesAction,
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

type Kind = HrAnomalyDTO["kind"];

/** Propriétés de l'encadré des anomalies RH (données sérialisables uniquement). */
export interface HrAnomaliesProps {
  anomalies: HrAnomalyDTO[];
  /** Écritures concernées par les anomalies affichées, par identifiant. */
  entries: Record<string, HrEntryDTO>;
  /** Clés de toutes les anomalies à traiter (même non affichées), par type : pour « Tout valider ». */
  keysByKind: Record<Kind, string[]>;
  validated: HrValidatedAnomalyDTO[];
  /** Nombre total d'anomalies à traiter (peut dépasser le nombre affiché). */
  total: number;
  /** Adresse qui affiche toutes les anomalies, ou null si tout est déjà affiché. */
  showAllHref: string | null;
  /** Adresse qui revient à l'affichage réduit, ou null. */
  showLessHref: string | null;
  canEdit: boolean;
  beneficiaries: string[];
  today: string;
}

const KIND_LABELS: Readonly<Record<Kind, string>> = {
  doublon: "Doublon",
  beneficiaire: "Bénéficiaire",
  periode: "Période",
};
const KINDS: readonly Kind[] = ["doublon", "beneficiaire", "periode"];

/** Action en cours de confirmation : validation d'une anomalie ou d'un type entier, ou suppression d'une écriture. */
type Pending =
  | { type: "valider"; key: string }
  | { type: "tout"; kind: Kind }
  | { type: "supprimer"; key: string; entryId: string }
  | null;

const RELEVE_LABELS = {
  rapproche: "Rapproché au relevé",
  probable: "Probable au relevé",
  non_trouve: "Non trouvé au relevé",
  na: "",
} as const;

const describeEntry = (entry: HrEntryDTO): string =>
  `${entry.date ? `du ${formatDate(entry.date)}` : "sans date"}, ${entry.nature} – ${entry.beneficiaire || "sans bénéficiaire"}, ${formatDA(entry.montant)}${entry.cheque ? `, chèque ${entry.cheque}` : ""}`;
const entryLabel = (entry: HrEntryDTO): string =>
  `l'écriture ${entry.date ? `du ${formatDate(entry.date)} ` : ""}de ${formatDA(entry.montant)}`;

/**
 * Encadré des anomalies RH : pour chaque anomalie, corriger l'écriture (fenêtre de saisie existante), supprimer une des écritures d'un doublon
 * (après confirmation) ou valider l'anomalie (« vérifiée, c'est normal »), une par une ou par type. Les anomalies validées restent consultables et rétablissables.
 */
export function HrAnomalies({
  anomalies,
  entries,
  keysByKind,
  validated,
  total,
  showAllHref,
  showLessHref,
  canEdit,
  beneficiaries,
  today,
}: Readonly<HrAnomaliesProps>): React.JSX.Element | null {
  const router = useRouter();
  const [action, setAction] = useState<Pending>(null);
  const [motif, setMotif] = useState("");
  const [error, setError] = useState<{ key: string; message: string } | null>(
    null,
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  if (total === 0 && validated.length === 0) return null;

  /** Exécute une action sur la ligne `key` : attente et erreur sont affichées sur cette ligne ; une anomalie disparue (NOT_FOUND) recharge la page. */
  function run(
    key: string,
    task: () => Promise<
      { success: true } | { success: false; error: string; code?: string }
    >,
  ): void {
    setError(null);
    setBusy(key);
    startTransition(async () => {
      const result = await task();
      setBusy((current) => (current === key ? null : current));
      if (result.success) {
        setAction(null);
        setMotif("");
        return;
      }
      setError({ key, message: result.error });
      if (result.code === "NOT_FOUND") router.refresh();
    });
  }

  const open = (next: Pending): void => {
    setError(null);
    setMotif("");
    setAction(next);
  };

  const rowError = (key: string): React.JSX.Element | null =>
    error?.key === key ? (
      <p
        role="alert"
        className="mt-2 rounded-md bg-destructive/10 p-2 text-sm text-destructive"
      >
        {error.message}
      </p>
    ) : null;

  const motifForm = (
    key: string,
    keys: string[],
    label: string,
  ): React.JSX.Element => (
    <form
      className="mt-2 flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        run(key, () => validateHrAnomaliesAction({ keys, motif }));
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
      <Button type="submit" size="sm" disabled={busy === key}>
        {busy === key ? "Validation…" : label}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={busy === key}
        onClick={() => setAction(null)}
      >
        Annuler
      </Button>
    </form>
  );

  return (
    <Card className="mb-4 border-warning/40 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <AlertTriangle className="size-4 text-warning" aria-hidden />
          Anomalies ({total})
        </h2>
        <Button type="button" size="sm" variant="outline" className="ml-auto" onClick={() => router.refresh()} aria-label="Revérifier les anomalies maintenant">
          Revérifier
        </Button>
      </div>
      <p className="mb-2 text-xs text-muted-foreground">
        Indications à vérifier : rien n'est modifié automatiquement. Corrigez
        l'écriture, supprimez le doublon, ou validez l'anomalie si elle est
        normale.
      </p>
      {canEdit && total > 0 ? (
        <div className="mb-2 flex flex-wrap gap-2">
          {KINDS.filter((kind) => keysByKind[kind].length > 0).map((kind) => (
            <Button
              key={kind}
              type="button"
              size="sm"
              variant="outline"
              disabled={busy !== null}
              onClick={() => open({ type: "tout", kind })}
            >
              Tout valider : {KIND_LABELS[kind]} ({keysByKind[kind].length})
            </Button>
          ))}
        </div>
      ) : null}
      {action?.type === "tout" ? (
        <div className="mb-3 rounded-md border p-2 text-sm">
          <p>
            Valider les {keysByKind[action.kind].length} anomalie(s) «{" "}
            {KIND_LABELS[action.kind]} » de l'année affichée, y compris celles
            qui ne sont pas listées ci-dessous ? Elles réapparaîtront si
            l'écriture concernée est modifiée.
          </p>
          {motifForm(
            "tout",
            keysByKind[action.kind],
            "Confirmer : tout valider",
          )}
        </div>
      ) : null}
      {rowError("tout")}
      {total === 0 ? (
        <p className="text-sm text-muted-foreground">
          Aucune anomalie à traiter.
        </p>
      ) : null}
      <ul className="space-y-3 text-sm">
        {anomalies.map((anomaly) => {
          const items = anomaly.entryIds.flatMap((id) =>
            entries[id] ? [entries[id]] : [],
          );
          const target =
            action?.type === "supprimer" && action.key === anomaly.key
              ? items.find((entry) => entry.id === action.entryId)
              : undefined;
          const rowBusy = busy === anomaly.key;
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
                  {items.map((entry, index) => (
                    <span
                      key={entry.id}
                      className="flex flex-wrap items-center gap-2 text-xs"
                    >
                      <span className="text-muted-foreground">
                        {items.length > 1
                          ? `Écriture ${index + 1} :`
                          : "Écriture :"}
                      </span>
                      <HrEntryDialog
                        entry={entry}
                        beneficiaries={beneficiaries}
                        today={today}
                        triggerLabel="Corriger"
                        triggerAriaLabel={`Corriger ${entryLabel(entry)}`}
                      />
                      {anomaly.kind === "doublon" ? (
                        <>
                          <button
                            type="button"
                            disabled={rowBusy}
                            aria-label={`Supprimer ${entryLabel(entry)}`}
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
                          {RELEVE_LABELS[entry.releve.status] ? (
                            <span className="text-muted-foreground">
                              ({RELEVE_LABELS[entry.releve.status]})
                            </span>
                          ) : null}
                        </>
                      ) : null}
                    </span>
                  ))}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={rowBusy}
                    onClick={() => open({ type: "valider", key: anomaly.key })}
                  >
                    Valider
                  </Button>
                </div>
              ) : null}
              {action?.type === "valider" && action.key === anomaly.key
                ? motifForm(
                    anomaly.key,
                    [anomaly.key],
                    "Confirmer la validation",
                  )
                : null}
              {target ? (
                <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md bg-destructive/10 p-2">
                  <span className="min-w-0 flex-1 text-destructive">
                    Supprimer définitivement l'écriture {describeEntry(target)}{" "}
                    ? Les totaux mensuels seront recalculés. Vérifiez le relevé
                    : si le paiement a réellement eu lieu puis été rejeté,
                    saisissez plutôt un retour.
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    disabled={rowBusy}
                    onClick={() =>
                      run(anomaly.key, () =>
                        deleteHrEntryAction({ id: target.id }),
                      )
                    }
                  >
                    {rowBusy ? "Suppression…" : "Confirmer la suppression"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={rowBusy}
                    onClick={() => setAction(null)}
                  >
                    Annuler
                  </Button>
                </div>
              ) : null}
              {rowError(anomaly.key)}
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
      {showLessHref ? (
        <p className="mt-2 text-sm">
          <Link
            href={showLessHref}
            className="font-medium text-primary hover:underline"
          >
            Afficher moins
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
              <li key={item.key}>
                <div className="flex flex-wrap items-start gap-2">
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
                      disabled={busy === item.key}
                      onClick={() =>
                        run(item.key, () =>
                          restoreHrAnomalyAction({ key: item.key }),
                        )
                      }
                    >
                      {busy === item.key ? "Rétablissement…" : "Rétablir"}
                    </Button>
                  ) : null}
                </div>
                {rowError(item.key)}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </Card>
  );
}
