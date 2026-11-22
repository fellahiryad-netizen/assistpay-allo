"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Copy, FlaskConical, Pencil, Play, Plus, RotateCcw, Trash2, Undo2 } from "lucide-react";
import {
  activateScenarioAction,
  addSimulationLineAction,
  clearScenarioAction,
  createScenarioAction,
  decideSimulationLineAction,
  deleteScenarioAction,
  duplicateScenarioAction,
  removeSimulationLineAction,
  updateSimulationLineAction,
} from "@/app/actions/treasury-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import type { Suggestion } from "@/features/treasury/lib/duplicates";
import { MAX_LINES_PER_SCENARIO, SIM_CERTAINTIES, SIM_MODES, SIM_MODE_LABELS, SIM_TYPES, SIM_TYPE_LABELS, SIM_CONFIRM_AMOUNT, type SimCertainty, type SimMode, type SimType } from "@/features/treasury/types";
import type { ActiveScenarioView, ScenarioSummary } from "@/features/treasury/types/view";
import { parseLooseAmount } from "@/utils/amounts";
import { formatDA, formatDate, formatDateTime } from "@/utils/format";

/** Propriétés du panneau de simulation de la comptable (données sérialisables). */
export interface SimulationPanelProps {
  scenarios: ScenarioSummary[];
  active: ActiveScenarioView | null;
  suggestions: Record<SimType, Suggestion>;
  /** Date du solde `AAAA-MM-JJ` : les lignes ne peuvent pas la précéder. */
  balanceDate: string;
}

interface FormState {
  type: SimType;
  libelle: string;
  periode: string;
  montant: string;
  date: string;
  mode: SimMode;
  certitude: SimCertainty;
  confirmer: boolean;
}

const emptyForm = (date: string): FormState => ({ type: "G50", libelle: "", periode: "", montant: "", date, mode: "CHEQUE", certitude: "ESTIME", confirmer: false });

/**
 * Panneau de simulation : scénarios nommés (créer, dupliquer, activer, supprimer, réinitialiser), formulaire d'ajout de paiement simulé,
 * suggestions non automatiques, liste modifiable et alerte anti-doublon. Rien ici ne modifie les factures, les demandes ni le RH.
 */
export function SimulationPanel({ scenarios, active, suggestions, balanceDate }: Readonly<SimulationPanelProps>): React.JSX.Element {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [name, setName] = useState("");
  const [form, setForm] = useState<FormState>(emptyForm(balanceDate));
  const [editing, setEditing] = useState<string | null>(null);

  function run(task: () => Promise<{ success: boolean; error?: string }>, done: string, after?: () => void): void {
    startTransition(async () => {
      const result = await task();
      if (result.success) {
        setMessage({ kind: "ok", text: done });
        after?.();
        router.refresh();
      } else setMessage({ kind: "error", text: result.error ?? "L'opération a échoué." });
    });
  }

  const amount = parseLooseAmount(form.montant);
  const suggestion = suggestions[form.type];
  const reset = (): void => {
    setForm(emptyForm(balanceDate));
    setEditing(null);
  };

  function submit(): void {
    if (!active) return;
    if (!Number.isFinite(amount) || amount <= 0) {
      setMessage({ kind: "error", text: "Indiquez un montant supérieur à zéro." });
      return;
    }
    const payload = { scenarioId: active.id, type: form.type, libelle: form.libelle, periode: form.periode, montant: amount, date: form.date, mode: form.mode, certitude: form.certitude, confirmer: form.confirmer };
    if (editing) run(() => updateSimulationLineAction({ ...payload, lineId: editing }), "Ligne modifiée.", reset);
    else run(() => addSimulationLineAction(payload), "Ligne ajoutée à la simulation.", reset);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FlaskConical aria-hidden className="size-5" />
          Simulation (CNAS, G50, IRG / IBS, salaires)
        </CardTitle>
        <CardDescription>
          Saisissez ici les paiements que le journal ne connaît pas encore. Ces lignes ne modifient jamais les factures, les demandes de paiement ni le RH : elles ne servent qu&apos;à voir l&apos;effet sur le solde. Aucune date légale n&apos;est supposée : vous saisissez la date prévue.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {message ? (
          <p role={message.kind === "error" ? "alert" : "status"} className={`rounded-md border-2 p-2 text-sm font-medium ${message.kind === "error" ? "border-destructive bg-destructive/10" : "border-success bg-success/10"}`}>
            {message.text}
          </p>
        ) : null}

        <section aria-label="Scénarios" className="space-y-3">
          <h3 className="text-sm font-semibold">Scénarios nommés ({scenarios.length} sur 20)</h3>
          <ul className="space-y-2">
            {scenarios.map((scenario) => {
              const isActive = active?.id === scenario.id;
              return (
                <li key={scenario.id} className={`flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 ${isActive ? "border-2 border-primary" : ""}`}>
                  <span className="text-sm">
                    <b>{scenario.nom}</b> {isActive ? <Badge>actif</Badge> : null}
                    <span className="block text-xs text-muted-foreground">
                      {scenario.lines} ligne{scenario.lines > 1 ? "s" : ""} · créé le {formatDateTime(scenario.creeLe).slice(0, 10)}
                      {scenario.creePar ? ` par ${scenario.creePar}` : ""}
                    </span>
                  </span>
                  <span className="flex flex-wrap gap-1">
                    {!isActive ? (
                      <Button type="button" size="sm" variant="violet" disabled={pending} onClick={() => run(() => activateScenarioAction({ scenarioId: scenario.id }), `Scénario « ${scenario.nom} » activé.`)}>
                        <Play />
                        Activer
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() => {
                        const copy = window.prompt("Nom de la copie :", `${scenario.nom} (copie)`);
                        if (copy) run(() => duplicateScenarioAction({ scenarioId: scenario.id, nom: copy }), "Scénario dupliqué.");
                      }}
                    >
                      <Copy />
                      Dupliquer
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={pending || scenario.lines === 0}
                      onClick={() => {
                        if (window.confirm(`Retirer les ${scenario.lines} lignes du scénario « ${scenario.nom} » ?`)) run(() => clearScenarioAction({ scenarioId: scenario.id }), "Scénario réinitialisé.");
                      }}
                    >
                      <RotateCcw />
                      Réinitialiser
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() => {
                        if (window.confirm(`Supprimer le scénario « ${scenario.nom} » ?`)) run(() => deleteScenarioAction({ scenarioId: scenario.id }), "Scénario supprimé.");
                      }}
                    >
                      <Trash2 />
                      Supprimer
                    </Button>
                  </span>
                </li>
              );
            })}
            {scenarios.length === 0 ? <li className="text-sm text-muted-foreground">Aucun scénario. Créez-en un (« Fin novembre », « Cas prudent »…).</li> : null}
          </ul>
          <div className="flex flex-wrap items-end gap-2">
            <Field id="tr-scn-name" label="Nouveau scénario" className="min-w-56 flex-1">
              <Input id="tr-scn-name" value={name} maxLength={80} onChange={(event) => setName(event.target.value)} placeholder="Ex. Fin novembre" />
            </Field>
            <Button type="button" variant="violet" disabled={pending || name.trim() === ""} onClick={() => run(() => createScenarioAction({ nom: name }), "Scénario créé.", () => setName(""))}>
              <Plus />
              Créer
            </Button>
            {active ? (
              <Button type="button" variant="outline" disabled={pending} onClick={() => run(() => activateScenarioAction({ scenarioId: null }), "Retour à la situation réelle.")}>
                <Undo2 />
                Retour au réel
              </Button>
            ) : null}
          </div>
        </section>

        {active ? (
          <>
            <section aria-label="Paiement simulé" className="space-y-3 border-t pt-4">
              <h3 className="text-sm font-semibold">{editing ? "Modifier le paiement simulé" : "Ajouter un paiement simulé"} — scénario « {active.nom} »</h3>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Field id="tr-type" label="Type">
                  <NativeSelect id="tr-type" value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value as SimType })}>
                    {SIM_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {SIM_TYPE_LABELS[type]}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field id="tr-libelle" label="Libellé" className="lg:col-span-2">
                  <Input id="tr-libelle" value={form.libelle} maxLength={120} onChange={(event) => setForm({ ...form, libelle: event.target.value })} placeholder="Ex. G50 octobre" />
                </Field>
                <Field id="tr-periode" label="Période concernée">
                  <Input id="tr-periode" type="month" value={form.periode} onChange={(event) => setForm({ ...form, periode: event.target.value })} />
                </Field>
                <Field id="tr-montant" label="Montant (DA)">
                  <Input id="tr-montant" inputMode="decimal" value={form.montant} onChange={(event) => setForm({ ...form, montant: event.target.value })} placeholder="0,00" />
                </Field>
                <Field id="tr-date" label="Date prévue" hint={`Au plus tôt le ${formatDate(balanceDate)}`}>
                  <Input id="tr-date" type="date" min={balanceDate} value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} />
                </Field>
                <Field id="tr-mode" label="Mode">
                  <NativeSelect id="tr-mode" value={form.mode} onChange={(event) => setForm({ ...form, mode: event.target.value as SimMode })}>
                    {SIM_MODES.map((mode) => (
                      <option key={mode} value={mode}>
                        {SIM_MODE_LABELS[mode]}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field id="tr-certitude" label="Certitude">
                  <NativeSelect id="tr-certitude" value={form.certitude} onChange={(event) => setForm({ ...form, certitude: event.target.value as SimCertainty })}>
                    {SIM_CERTAINTIES.map((value) => (
                      <option key={value} value={value}>
                        {value === "CERTAIN" ? "Montant certain" : "Estimation"}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
              </div>
              {suggestion.last || suggestion.average ? (
                <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  Suggestions (jamais appliquées seules) :
                  {suggestion.last ? (
                    <Button type="button" size="sm" variant="outline" onClick={() => setForm({ ...form, montant: String(suggestion.last?.montant ?? "").replace(".", ",") })}>
                      Dernier mois connu ({suggestion.last.label}) : {formatDA(suggestion.last.montant)} — Utiliser cette valeur
                    </Button>
                  ) : null}
                  {suggestion.average ? (
                    <Button type="button" size="sm" variant="outline" onClick={() => setForm({ ...form, montant: String(suggestion.average?.montant ?? "").replace(".", ",") })}>
                      Moyenne {suggestion.average.months} mois : {formatDA(suggestion.average.montant)} — Utiliser cette valeur
                    </Button>
                  ) : null}
                </p>
              ) : null}
              {Number.isFinite(amount) && amount > SIM_CONFIRM_AMOUNT ? (
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input type="checkbox" checked={form.confirmer} onChange={(event) => setForm({ ...form, confirmer: event.target.checked })} />
                  Je confirme ce montant ({formatDA(amount)}), supérieur à {formatDA(SIM_CONFIRM_AMOUNT)}.
                </label>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button type="button" disabled={pending || form.libelle.trim() === "" || (active.lignes.length >= MAX_LINES_PER_SCENARIO && !editing)} onClick={submit}>
                  {editing ? <Pencil /> : <Plus />}
                  {editing ? "Enregistrer la modification" : "Ajouter à la simulation"}
                </Button>
                {editing ? (
                  <Button type="button" variant="outline" onClick={reset}>
                    Annuler la modification
                  </Button>
                ) : null}
              </div>
            </section>

            <section aria-label="Lignes simulées" className="space-y-2 border-t pt-4">
              <h3 className="text-sm font-semibold">
                Lignes simulées ({active.lignes.length} sur {MAX_LINES_PER_SCENARIO})
              </h3>
              <ul className="space-y-2">
                {active.lignes.map((line) => (
                  <li key={line.id} className="rounded-md border p-2 text-sm">
                    {line.warnings.length > 0 ? (
                      <div role="alert" className="mb-2 rounded-md border-2 border-warning bg-warning/10 p-2">
                        {line.warnings.map((warning) => (
                          <p key={warning} className="font-medium">
                            {warning}
                          </p>
                        ))}
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Button type="button" size="sm" variant="destructive" disabled={pending} onClick={() => run(() => decideSimulationLineAction({ scenarioId: active.id, lineId: line.id, decision: "ignorer" }), "Ligne exclue du calcul.")}>
                            C&apos;est un doublon, ne pas compter
                          </Button>
                          <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => run(() => decideSimulationLineAction({ scenarioId: active.id, lineId: line.id, decision: "garder" }), "Ligne gardée.")}>
                            Garder quand même
                          </Button>
                        </div>
                      </div>
                    ) : null}
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className={line.decision === "ignorer" ? "line-through opacity-70" : ""}>
                        <b>{SIM_TYPE_LABELS[line.type]}</b> {line.libelle} — <b className="tabular-nums">{formatDA(line.montant)}</b> le {formatDate(line.date)} · {SIM_MODE_LABELS[line.mode]} · {line.certitude === "CERTAIN" ? "montant certain" : "estimation"}
                        {line.periode ? ` · période ${line.periode}` : ""}
                        {line.decision === "ignorer" ? <Badge variant="muted" className="ml-2">non comptée (doublon)</Badge> : null}
                        {line.decision === "garder" ? <Badge variant="muted" className="ml-2">gardée malgré le doublon</Badge> : null}
                      </span>
                      <span className="flex gap-1">
                        {line.decision !== null ? (
                          <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => run(() => decideSimulationLineAction({ scenarioId: active.id, lineId: line.id, decision: null }), "Décision retirée.")}>
                            <Undo2 />
                            Recompter
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setEditing(line.id);
                            setForm({ type: line.type, libelle: line.libelle, periode: line.periode, montant: String(line.montant).replace(".", ","), date: line.date, mode: line.mode, certitude: line.certitude, confirmer: line.montant > SIM_CONFIRM_AMOUNT });
                          }}
                        >
                          <Pencil />
                          Modifier
                        </Button>
                        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => run(() => removeSimulationLineAction({ scenarioId: active.id, lineId: line.id }), "Ligne supprimée.")}>
                          <Trash2 />
                          Supprimer
                        </Button>
                      </span>
                    </div>
                  </li>
                ))}
                {active.lignes.length === 0 ? <li className="text-sm text-muted-foreground">Aucune ligne : la situation affichée est encore la situation réelle.</li> : null}
              </ul>
            </section>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Activez un scénario pour saisir des paiements simulés.</p>
        )}
      </CardContent>
    </Card>
  );
}
