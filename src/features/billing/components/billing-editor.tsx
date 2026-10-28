"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { ClipboardPaste, Plus, Save, X } from "lucide-react";
import { prepareBillingAction, saveBillingAction } from "@/app/actions/billing-actions";
import { Notice } from "@/components/common/notice";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { BDG_TYPES, BRANCHES, CLIENT_LABELS, CLIENTS, PRESETS, presetById, type BillingRow } from "@/features/billing/config";
import { InvoiceDocument } from "@/features/billing/components/invoice-document";
import { columnLabel, computeBilling, periodLabel, visibleColumns } from "@/features/billing/services/billing-calc";
import type { BillingDraft } from "@/features/billing/types";
import { amountInWords } from "@/utils/amounts";
import { formatDA } from "@/utils/format";

/** Propriétés de l'éditeur de facture. */
export interface BillingEditorProps {
  initial: BillingDraft;
  issuedId?: string;
  canEdit: boolean;
  /** Limite le choix aux factures BDG (onglet BDG) ou BDG GAM. */
  scope?: "all" | "bdg" | "gam";
}

const DETAIL_FIELDS: ReadonlyArray<[string, string]> = [
  ["date", "Date et heure d'intervention"],
  ["type", "Type de prestation"],
  ["immat", "Immatriculation"],
  ["modele", "Modèle du véhicule"],
  ["lieu", "Lieu de prise en charge"],
  ["dest", "Destination"],
];

/** Éditeur de facture : modèle du client, lignes, totaux et aperçu en direct ; enregistrement au Crédit. */
export function BillingEditor({ initial, issuedId, canEdit, scope = "all" }: Readonly<BillingEditorProps>): React.JSX.Element {
  const router = useRouter();
  const [draft, setDraft] = useState<BillingDraft>(initial);
  const [motif, setMotif] = useState("");
  const [paste, setPaste] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(
    initial.fromPrev ? { tone: "info", text: `Lignes reprises de la facture ${initial.fromPrev} : mettez à jour les montants.` } : null,
  );
  const [pending, startTransition] = useTransition();
  const preset = presetById(draft.preset);
  const columns = visibleColumns(draft);
  const { rows, totals } = useMemo(() => computeBilling(draft), [draft]);
  const editable = canEdit;
  const clientKeys = Object.keys(CLIENTS);
  const presetChoices = PRESETS.filter((entry) => entry.c === draft.client && (scope === "bdg" ? entry.m === "bdgpair" : scope === "gam" ? entry.m === "bdggam" : true));

  function set<K extends keyof BillingDraft>(key: K, value: BillingDraft[K]): void {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function setRow(index: number, key: string, value: string): void {
    setDraft((current) => ({ ...current, rows: current.rows.map((row, i) => (i === index ? { ...row, [key]: value } : row)) }));
  }

  function reload(presetId: string, client?: string, bdgType?: BillingDraft["bdgType"]): void {
    startTransition(async () => {
      const result = await prepareBillingAction({ preset: presetId, client, bdgType });
      if (result.success) {
        setDraft(result.data);
        setMessage(result.data.fromPrev ? { tone: "info", text: `Lignes reprises de la facture ${result.data.fromPrev} : mettez à jour les montants.` } : null);
      } else setMessage({ tone: "error", text: result.error });
    });
  }

  function applyPaste(): void {
    if (!paste) return;
    const keys = columns.filter((col) => !col.calc).map((col) => col.k);
    const added: BillingRow[] = paste
      .split(/\r?\n/)
      .map((line) => line.split("\t"))
      .filter((cells) => cells.some((cellValue) => cellValue.trim()))
      .map((cells) => {
        const row: BillingRow = {};
        keys.forEach((key, index) => {
          row[key] = (cells[index] ?? "").trim();
        });
        if (preset.m === "bdgpair" && !row.pu && draft.bdgType !== "deb") row.pu = "800";
        return row;
      })
      .filter((row) => !/^(TOTAL|AGENCE)/i.test(row[keys[0] ?? ""] ?? ""));
    if (!added.length) {
      setMessage({ tone: "error", text: "Rien à coller." });
      return;
    }
    setDraft((current) => ({ ...current, rows: [...current.rows.filter((row) => keys.some((key) => String(row[key] ?? "").trim())), ...added] }));
    setPaste(null);
    setMessage({ tone: "success", text: `${added.length} ligne(s) ajoutée(s).` });
  }

  function save(): void {
    startTransition(async () => {
      const result = await saveBillingAction({ draft, issuedId, motif: issuedId ? motif : undefined });
      if (!result.success) {
        setMessage({ tone: "error", text: result.error });
        return;
      }
      router.push(`/facturation/${result.data.id}?enregistre=1`);
    });
  }

  const text = (key: "num" | "num2" | "date" | "objet" | "perTxt" | "bc" | "origine" | "destination", label: string, type = "text"): React.JSX.Element => (
    <Field id={`fx-${key}`} label={label}>
      <Input id={`fx-${key}`} type={type} value={draft[key]} disabled={!editable} onChange={(event) => set(key, event.target.value)} />
    </Field>
  );

  return (
    <div className="grid grid-cols-1 gap-5 2xl:grid-cols-2">
      <Card>
        <CardContent className="flex flex-col gap-4 pt-4 sm:pt-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {scope === "all" ? (
              <>
                <Field id="fx-client" label="Client">
                  <NativeSelect
                    id="fx-client"
                    value={draft.client}
                    disabled={!editable || Boolean(issuedId)}
                    onChange={(event) => {
                      const first = PRESETS.find((entry) => entry.c === event.target.value);
                      if (first) reload(first.id, event.target.value);
                    }}
                  >
                    {clientKeys.map((key) => (
                      <option key={key} value={key}>
                        {CLIENT_LABELS[key] ?? key}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field id="fx-preset" label="Modèle de facture">
                  <NativeSelect id="fx-preset" value={draft.preset} disabled={!editable || Boolean(issuedId)} onChange={(event) => reload(event.target.value, draft.client)}>
                    {presetChoices.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.lbl}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
              </>
            ) : (
              <Field id="fx-preset" label={scope === "bdg" ? "Client BDG" : "Facture globale"}>
                <NativeSelect id="fx-preset" value={draft.preset} disabled={!editable || Boolean(issuedId)} onChange={(event) => reload(event.target.value)}>
                  {(scope === "bdg"
                    ? [
                        ["c_bdg", "CAAT – par succursale"],
                        ["t_bdg", "TRUST – par dossier (800 DA HT de frais)"],
                      ]
                    : [
                        ["g_bdgab_c", "Conventionnelle"],
                        ["g_bdgab_t", "Takaful"],
                      ]
                  ).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            )}
            {preset.m === "bdgpair" ? (
              <Field id="fx-bdg" label="Type de facture BDG">
                <NativeSelect
                  id="fx-bdg"
                  value={draft.bdgType}
                  disabled={!editable || Boolean(issuedId)}
                  onChange={(event) => reload(draft.preset, draft.client, event.target.value === "deb" ? "deb" : event.target.value === "fra" ? "fra" : "pair")}
                >
                  {Object.entries(BDG_TYPES).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            ) : null}
            {preset.m !== "bdgpair" || draft.bdgType !== "fra" ? text("num", preset.m === "bdgpair" ? "N° facture débours" : "N° de facture") : null}
            {preset.m === "bdgpair" && draft.bdgType !== "deb" ? text("num2", "N° facture frais de gestion") : null}
            {text("date", "Date de facture", "date")}
            {text("objet", preset.objLbl ?? "Honoraire / objet")}
            <Field id="fx-per" label="Mois concerné">
              <Input
                id="fx-per"
                type="month"
                value={draft.per}
                disabled={!editable}
                onChange={(event) => setDraft((current) => ({ ...current, per: event.target.value, perTxt: periodLabel(event.target.value) }))}
              />
            </Field>
            {text("perTxt", preset.perTitle || (preset.m === "caar" ? "Mois de" : "Période (texte affiché)"))}
            {preset.succ ? (
              <Field id="fx-succ" label="Succursale">
                <NativeSelect id="fx-succ" value={draft.succ} disabled={!editable} onChange={(event) => set("succ", event.target.value)}>
                  <option value="">—</option>
                  {(preset.succList ?? BRANCHES[draft.client] ?? []).map((branch) => (
                    <option key={branch} value={branch}>
                      {branch}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            ) : null}
            {preset.bc ? text("bc", "Bon de commande N°") : null}
            {preset.route ? (
              <>
                {text("origine", "Origine")}
                {text("destination", "Destination")}
              </>
            ) : null}
            {issuedId ? (
              <Field id="fx-motif" label="Motif de la rectification (obligatoire)" className="sm:col-span-2">
                <Input id="fx-motif" value={motif} onChange={(event) => setMotif(event.target.value)} placeholder="Ex. erreur de montant signalée par le client" />
              </Field>
            ) : null}
          </div>
          {preset.details ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {DETAIL_FIELDS.map(([key, label]) => (
                <Field key={key} id={`fx-d-${key}`} label={label}>
                  <Input id={`fx-d-${key}`} value={draft.details[key] ?? ""} disabled={!editable} onChange={(event) => set("details", { ...draft.details, [key]: event.target.value })} />
                </Field>
              ))}
            </div>
          ) : null}
          <div className="flex flex-col gap-2">
            <p className="text-sm font-semibold">Lignes de la facture</p>
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full min-w-max text-sm">
                <thead className="bg-muted/60 text-xs text-muted-foreground">
                  <tr>
                    {columns.map((col) => (
                      <th key={col.k} className={col.t ? "px-2 py-2 text-right" : "px-2 py-2 text-left"}>
                        {columnLabel(preset, col)}
                      </th>
                    ))}
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {draft.rows.map((row, index) => (
                    <tr key={index} className="border-t">
                      {columns.map((col) => (
                        <td key={col.k} className="px-1 py-1">
                          {col.calc ? (
                            <span className="block px-2 text-right tabular-nums text-muted-foreground">{formatDA(Number(rows[index]?.[col.k] ?? 0))}</span>
                          ) : (
                            <Input
                              aria-label={columnLabel(preset, col)}
                              className={col.t ? "h-8 text-right text-xs" : "h-8 text-xs"}
                              inputMode={col.t ? "decimal" : undefined}
                              value={row[col.k] ?? ""}
                              disabled={!editable}
                              onChange={(event) => setRow(index, col.k, event.target.value)}
                            />
                          )}
                        </td>
                      ))}
                      <td className="px-1">
                        {editable ? (
                          <button
                            type="button"
                            aria-label="Supprimer la ligne"
                            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
                            onClick={() => setDraft((current) => ({ ...current, rows: current.rows.length > 1 ? current.rows.filter((_, i) => i !== index) : [{}] }))}
                          >
                            <X className="size-4" />
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {editable ? (
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => setDraft((current) => ({ ...current, rows: [...current.rows, preset.m === "bdgpair" ? { pu: "800", nb: draft.client === "TRUST" ? "1" : "" } : {}] }))}>
                  <Plus />
                  Ajouter une ligne
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => setPaste(paste === null ? "" : null)}>
                  <ClipboardPaste />
                  Coller depuis Excel
                </Button>
              </div>
            ) : null}
            {paste !== null ? (
              <div className="flex flex-col gap-2">
                <p className="text-xs text-muted-foreground">
                  Copiez les lignes dans Excel, colonnes dans cet ordre : {columns.filter((col) => !col.calc).map((col) => columnLabel(preset, col)).join(" · ")}, puis collez-les ici.
                </p>
                <textarea rows={4} value={paste} onChange={(event) => setPaste(event.target.value)} className="w-full rounded-md border border-input bg-card px-3 py-2 font-mono text-xs" aria-label="Lignes copiées depuis Excel" />
                <div>
                  <Button type="button" size="sm" onClick={applyPaste}>
                    Ajouter ces lignes
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
          <Field id="fx-notes" label="Mentions sous le tableau (liste jointe, contrat, annexe…)">
            <textarea id="fx-notes" rows={2} value={draft.notes} disabled={!editable} onChange={(event) => set("notes", event.target.value)} className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm" />
          </Field>
          <details className="rounded-md border p-3">
            <summary className="cursor-pointer text-sm font-medium">Coordonnées du client (RC, NIF, NIS…) — modifiables</summary>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {(
                [
                  ["nom", "Raison sociale"],
                  ["adresse", "Adresse"],
                  ["tel", "Téléphone"],
                  ["rc", "RC"],
                  ["nif", "NIF"],
                  ["nis", "NIS"],
                  ["ai", "Art. d'imposition"],
                ] as const
              ).map(([key, label]) => (
                <Field key={key} id={`fx-cli-${key}`} label={label}>
                  <Input id={`fx-cli-${key}`} value={draft.cli[key]} disabled={!editable} onChange={(event) => set("cli", { ...draft.cli, [key]: event.target.value })} />
                </Field>
              ))}
            </div>
          </details>
          <div className="rounded-md bg-muted/50 p-3">
            {totals.lines.map(([label, value, strong]) => (
              <div key={label} className={strong ? "flex justify-between border-t pt-1 font-semibold" : "flex justify-between text-sm"}>
                <span>{label}</span>
                <span className="tabular-nums">{formatDA(value)}</span>
              </div>
            ))}
            <p className="mt-2 text-xs text-muted-foreground">En lettres : {amountInWords(totals.ttc)}</p>
          </div>
          {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
          <div className="flex flex-wrap justify-end gap-2">
            {issuedId ? (
              <Link href={`/facturation/${issuedId}`} className={buttonVariants({ variant: "ghost" })}>
                Annuler
              </Link>
            ) : null}
            {editable ? (
              <Button type="button" onClick={save} disabled={pending}>
                <Save />
                {issuedId ? "Enregistrer la rectification" : "Enregistrer et ajouter au Crédit"}
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>
      <div className="overflow-x-auto rounded-lg border bg-muted p-3">
        <div className="origin-top-left scale-75">
          <InvoiceDocument draft={draft} />
        </div>
      </div>
    </div>
  );
}
