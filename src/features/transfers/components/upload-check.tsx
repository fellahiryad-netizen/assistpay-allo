"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { checkTransferFileAction } from "@/app/actions/transfer-actions";
import { FileDrop } from "@/components/common/file-drop";
import { Notice } from "@/components/common/notice";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { MONTHS_FR } from "@/utils/dates";

/** Dépôt d'un fichier de virements pour contrôle (RIB, plafond, doublons, changements de compte). */
export function UploadCheck({ month, year }: Readonly<{ month: string; year: number }>): React.JSX.Element {
  const router = useRouter();
  const [type, setType] = useState("auto");
  const [mois, setMois] = useState(month);
  const [annee, setAnnee] = useState(String(year));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function choose(file: File): void {
    setError(null);
    const form = new FormData();
    form.set("file", file);
    form.set("type", type);
    form.set("mois", mois);
    form.set("annee", annee);
    startTransition(async () => {
      const result = await checkTransferFileAction(form);
      if (result.success) router.push(`/virements/${result.data.id}`);
      else setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field id="vx-type" label="Activité">
          <NativeSelect id="vx-type" value={type} onChange={(event) => setType(event.target.value)}>
            <option value="auto">Détection automatique</option>
            <option value="A">Assistance routière</option>
            <option value="B">BDG</option>
          </NativeSelect>
        </Field>
        <Field id="vx-mois" label="Mois de l'envoi">
          <NativeSelect id="vx-mois" value={mois} onChange={(event) => setMois(event.target.value)}>
            {MONTHS_FR.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="vx-annee" label="Année">
          <Input id="vx-annee" type="number" min={2020} max={2100} value={annee} onChange={(event) => setAnnee(event.target.value)} />
        </Field>
      </div>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <FileDrop
        label={pending ? "Contrôle en cours…" : "Déposez le fichier de virements (VRMNT_ASSIS, VRMNT_BDG…)"}
        hint="Colonnes BANQUE, AGENCE, COMPTE, Clé, NOM, PRENOM, ADRESSE, MONTANT, SENS"
        disabled={pending}
        onFile={choose}
      />
    </div>
  );
}
