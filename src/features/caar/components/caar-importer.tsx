"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { previewCaarAction, saveCaarAction } from "@/app/actions/caar-actions";
import { FileDrop } from "@/components/common/file-drop";
import { Notice } from "@/components/common/notice";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { CAAR_BRANCHES } from "@/features/caar/schemas";
import type { CaarPreview } from "@/features/caar/services/caar-service";
import { MONTHS_FR } from "@/utils/dates";
import { formatDA } from "@/utils/format";

type Preview = CaarPreview;

/** Dépôt d'un fichier de production : aperçu du contrôle, puis enregistrement pour le mois et la succursale choisis. */
export function CaarImporter({ year, month }: Readonly<{ year: number; month: number }>): React.JSX.Element {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [annee, setAnnee] = useState(String(year));
  const [mois, setMois] = useState(String(month));
  const [succursale, setSuccursale] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function choose(chosen: File): void {
    setError(null);
    setPreview(null);
    setFile(chosen);
    const form = new FormData();
    form.set("file", chosen);
    startTransition(async () => {
      const result = await previewCaarAction(form);
      if (!result.success) {
        setError(result.error);
        return;
      }
      setPreview(result.data);
      if (result.data.period) {
        setAnnee(String(result.data.period.annee));
        setMois(String(result.data.period.mois));
      }
      if (result.data.succursale) setSuccursale(result.data.succursale);
    });
  }

  function save(): void {
    if (!file) return;
    setError(null);
    const form = new FormData();
    form.set("file", file);
    form.set("annee", annee);
    form.set("mois", mois);
    form.set("succursale", succursale);
    startTransition(async () => {
      const result = await saveCaarAction(form);
      if (result.success) router.push(`/caar/${result.data.id}`);
      else setError(result.error);
    });
  }

  const declared = preview?.declared;
  const gap = declared ? Math.round((preview.totals.prime - declared.prime) * 100) / 100 : 0;

  return (
    <div className="flex flex-col gap-4">
      <FileDrop label={pending && !preview ? "Contrôle en cours…" : "Déposez le fichier de production de la succursale"} hint="Colonnes reconnues automatiquement : agence, police, assuré, immatriculation, effet, échéance, formule, prime nette" disabled={pending} onFile={choose} />
      {error ? <Notice tone="error">{error}</Notice> : null}
      {preview ? (
        <Card className="flex flex-col gap-4 p-4">
          <div>
            <p className="font-semibold">{file?.name}</p>
            <p className="text-sm text-muted-foreground">
              Onglet « {preview.sheet} » · {preview.stats.lignes} lignes lues · {preview.totals.n} polices retenues · {preview.stats.excluded} exclues · {preview.anomalies} ligne(s) à faire corriger
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
            {(
              [
                ["Prime nette", preview.totals.prime],
                ["Part ALLO 47 %", preview.totals.allo],
                ["Avance 90 % HT", preview.totals.av],
                ["TVA 19 %", preview.totals.tva],
                ["TTC à facturer", preview.totals.ttc],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="rounded-md bg-muted/50 p-2">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="font-semibold tabular-nums">{formatDA(value)}</p>
              </div>
            ))}
          </div>
          {declared ? (
            <Notice tone={Math.abs(gap) < 1 ? "success" : "warning"}>
              Total déclaré dans le fichier (ligne {declared.line}) : {formatDA(declared.prime)}. {Math.abs(gap) < 1 ? "Identique au total recalculé." : `Écart avec le total recalculé : ${formatDA(gap)}.`}
            </Notice>
          ) : null}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field id="caar-succ" label="Succursale">
              <NativeSelect id="caar-succ" value={succursale} onChange={(event) => setSuccursale(event.target.value)}>
                <option value="">Choisir…</option>
                {CAAR_BRANCHES.map((branch) => (
                  <option key={branch} value={branch}>
                    {branch}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field id="caar-mois" label="Mois de production">
              <NativeSelect id="caar-mois" value={mois} onChange={(event) => setMois(event.target.value)}>
                {MONTHS_FR.map((name, index) => (
                  <option key={name} value={index + 1}>
                    {name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field id="caar-annee" label="Année">
              <Input id="caar-annee" type="number" min={2020} max={2100} value={annee} onChange={(event) => setAnnee(event.target.value)} />
            </Field>
          </div>
          <div className="flex justify-end">
            <Button onClick={save} disabled={pending || !succursale}>
              {pending ? "Enregistrement…" : "Enregistrer le contrôle"}
            </Button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
