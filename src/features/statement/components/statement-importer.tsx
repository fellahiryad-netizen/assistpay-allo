"use client";

import Link from "next/link";
import { useState } from "react";
import { CheckCheck, RefreshCw, RotateCcw, Search } from "lucide-react";
import { FileDrop } from "@/components/common/file-drop";
import { Notice } from "@/components/common/notice";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { NativeSelect } from "@/components/ui/native-select";
import { useStatementImport } from "@/features/statement/hooks/use-statement-import";
import type { ColumnMapping, Confidence } from "@/features/statement/types";
import { cn } from "@/utils/cn";
import { formatDA, formatDate } from "@/utils/format";

const MAPPING_FIELDS: ReadonlyArray<[keyof ColumnMapping, string]> = [
  ["date", "Date de l'opération"],
  ["libelle", "Libellé"],
  ["ref", "N° de pièce / référence (facultatif)"],
  ["credit", "Crédit (entrées)"],
  ["debit", "Débit (sorties)"],
  ["montant", "Ou montant unique (négatif = sortie)"],
];

const CONFIDENCE: Readonly<Record<Confidence, { label: string; variant: "success" | "default" | "warning" }>> = {
  sur: { label: "Sûr", variant: "success" },
  probable: { label: "Probable", variant: "default" },
  verifier: { label: "À vérifier", variant: "warning" },
};

/** Import du relevé bancaire : fichier, colonnes, analyse et validation des rapprochements. */
export function StatementImporter(): React.JSX.Element {
  const state = useStatementImport();
  const [sens, setSens] = useState<"CREDIT" | "DEBIT">("CREDIT");
  const visible = state.proposals.map((proposal, index) => ({ proposal, index })).filter((entry) => entry.proposal.proposal.line.sens === sens);
  const checked = visible.filter((entry) => entry.proposal.checked).length;
  const countFor = (value: "CREDIT" | "DEBIT"): number => state.proposals.filter((entry) => entry.proposal.line.sens === value).length;

  return (
    <div className="flex flex-col gap-4">
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
      {state.message ? <Notice tone="success">{state.message}</Notice> : null}

      {state.step === "file" ? (
        <div className="flex flex-col gap-3">
          <FileDrop
            label={state.pending ? "Lecture du fichier…" : "Déposez le relevé exporté de votre banque"}
            hint="Excel (.xlsx, .xls) ou CSV. Les lignes déjà importées sont reconnues automatiquement."
            disabled={state.pending}
            onFile={state.chooseFile}
          />
          <div>
            <Button type="button" variant="outline" onClick={state.recheck} disabled={state.pending}>
              <RefreshCw />
              Revérifier les lignes à traiter
            </Button>
          </div>
        </div>
      ) : null}

      {state.step === "mapping" && state.preview && state.mapping ? (
        <Card>
          <CardHeader>
            <CardTitle>Colonnes du fichier</CardTitle>
            <CardDescription>
              {state.preview.fileName} : {state.preview.rowCount} lignes lues. Vérifiez les colonnes, puis lancez le rapprochement.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {MAPPING_FIELDS.map(([key, label]) => (
                <Field key={key} id={`map-${key}`} label={label}>
                  <NativeSelect id={`map-${key}`} value={String(state.mapping?.[key] ?? -1)} onChange={(event) => state.setMapping(key, Number(event.target.value))}>
                    <option value="-1">—</option>
                    {state.preview?.headers.map((header, index) => (
                      <option key={`${header}-${index}`} value={index}>
                        {header}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
              ))}
            </div>
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-xs">
                <thead className="bg-muted/60">
                  <tr>
                    {state.preview.headers.map((header, index) => (
                      <th key={`${header}-${index}`} className="whitespace-nowrap px-2 py-1.5 text-left font-semibold">
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {state.preview.sample.map((row, rowIndex) => (
                    <tr key={rowIndex} className="border-t">
                      {state.preview?.headers.map((_, index) => (
                        <td key={index} className="whitespace-nowrap px-2 py-1.5">
                          {row[index] ?? ""}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="ghost" onClick={state.reset}>
                Changer de fichier
              </Button>
              <Button type="button" onClick={state.analyse} disabled={state.pending}>
                <Search />
                {state.pending ? "Analyse en cours…" : "Lancer le rapprochement"}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {state.step === "results" && state.analysis ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              ["Rapprochements à valider", state.proposals.length],
              ["Déjà enregistrés", state.analysis.recorded.length],
              ["Absents du suivi (à traiter)", state.analysis.todo.length],
              ["Déjà importés", state.analysis.alreadyImported],
            ].map(([label, value]) => (
              <Card key={String(label)} className="p-4">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="text-2xl font-semibold tabular-nums">{value}</p>
              </Card>
            ))}
          </div>
          {state.analysis.bankFees.count ? (
            <Notice tone="info">
              {state.analysis.bankFees.count} frais bancaires (commissions, TVA, Swift) écartés : {formatDA(state.analysis.bankFees.amount)} au total.
            </Notice>
          ) : null}
          {state.analysis.payrollLines ? (
            <Notice tone="info">
              {state.analysis.payrollLines} ligne(s) de paie détectée(s) (salaires, CNAS, impôts) : rapprochées des écritures RH quand elles existent, sinon placées « à traiter ».
            </Notice>
          ) : null}

          <Card>
            <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle>Rapprochements proposés</CardTitle>
                <CardDescription>Cochez ceux qui sont justes : les factures passent « réglées » à la date du relevé.</CardDescription>
              </div>
              <div className="flex gap-1">
                {(["CREDIT", "DEBIT"] as const).map((value) => (
                  <Button key={value} type="button" size="sm" variant={sens === value ? "default" : "outline"} onClick={() => setSens(value)}>
                    {value === "CREDIT" ? "Encaissements" : "Décaissements"} ({countFor(value)})
                  </Button>
                ))}
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {visible.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">Aucun rapprochement proposé de ce côté.</p>
              ) : (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="text-muted-foreground">
                      {checked} sur {visible.length} cochés
                    </span>
                    <span className="flex gap-2">
                      <Button type="button" size="sm" variant="ghost" onClick={() => state.toggleAll(sens, true)}>
                        Tout cocher
                      </Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => state.toggleAll(sens, false)}>
                        Tout décocher
                      </Button>
                    </span>
                  </div>
                  <ul className="flex flex-col divide-y rounded-md border">
                    {visible.map(({ proposal: entry, index }) => {
                      const line = entry.proposal.line;
                      const confidence = CONFIDENCE[entry.proposal.confidence];
                      return (
                        <li key={line.key} className={cn("flex flex-col gap-2 p-3 sm:flex-row sm:items-start", !entry.checked && "opacity-70")}>
                          <Checkbox
                            className="mt-1"
                            checked={entry.checked}
                            onChange={(event) => state.toggle(index, event.target.checked)}
                            aria-label={`Valider le paiement du ${formatDate(line.date)} de ${formatDA(line.montant)}`}
                          />
                          <div className="min-w-0 flex-1">
                            <p className="flex flex-wrap items-center gap-2 text-sm">
                              <span className="font-medium tabular-nums">{formatDate(line.date)}</span>
                              <span className="font-semibold tabular-nums">{formatDA(line.montant)}</span>
                              <Badge variant={confidence.variant}>{confidence.label}</Badge>
                              {entry.proposal.transferRef ? <Badge variant="accent">Envoi « {entry.proposal.transferRef} »</Badge> : null}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">{line.libelle}</p>
                            {entry.proposal.alternatives.length ? (
                              <NativeSelect
                                aria-label="Facture rapprochée"
                                className="mt-2 h-9 text-xs"
                                value={String(entry.choice)}
                                onChange={(event) => state.choose(index, Number(event.target.value))}
                              >
                                <option value="-1">{entry.proposal.items.map((item) => item.label).join(" + ")}</option>
                                {entry.proposal.alternatives.map((item, altIndex) => (
                                  <option key={`${item.invoiceId}-${item.part}`} value={altIndex}>
                                    {item.label}
                                  </option>
                                ))}
                              </NativeSelect>
                            ) : (
                              <p className="mt-1 text-sm">→ {entry.proposal.items.map((item) => `${item.label} (${formatDA(item.amount)})`).join(" + ")}</p>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                  <div className="flex justify-end">
                    <Button type="button" onClick={() => state.apply(sens)} disabled={state.pending || checked === 0}>
                      <CheckCheck />
                      Marquer ces factures réglées ({checked})
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {state.analysis.recorded.length ? (
            <details className="rounded-lg border bg-card p-4">
              <summary className="cursor-pointer text-sm font-medium">Paiements déjà enregistrés dans le suivi ({state.analysis.recorded.length})</summary>
              <ul className="mt-3 flex flex-col gap-1 text-sm">
                {state.analysis.recorded.map((match) => (
                  <li key={match.line.key} className="flex flex-wrap gap-x-2">
                    <span className="tabular-nums">{formatDate(match.line.date)}</span>
                    <span className="font-medium tabular-nums">{formatDA(match.line.montant)}</span>
                    <span className="text-muted-foreground">→ {match.labels.join(" + ")}</span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {state.analysis.todo.length ? (
              <Button variant="outline" asChild>
                <Link href="/releve?onglet=a-traiter">Voir les {state.analysis.todo.length} paiement(s) à traiter</Link>
              </Button>
            ) : null}
            <Button type="button" variant="ghost" onClick={state.reset}>
              <RotateCcw />
              Importer un autre relevé
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}
