"use client";

import { Fragment, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Plus, Printer, Save, Trash2 } from "lucide-react";
import { createEnvoiAction } from "@/app/actions/envoi-actions";
import { Notice } from "@/components/common/notice";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { bordereauDateLabel } from "@/features/courrier/lib/bordereau";
import { groupByCompany, sigleText, subtotalLabel } from "@/features/courrier/lib/company";
import { envoiCreateSchema } from "@/features/courrier/schemas";
import { DEFAULT_OBSERVATION, type Envoi, type EnvoiLine } from "@/features/courrier/types";

/** Propriétés de l'éditeur de bordereau. */
export interface BordereauEditorProps {
  initialLines: EnvoiLine[];
  /** Date du jour `AAAA-MM-JJ` (fuseau d'Alger), calculée côté serveur. */
  initialDate: string;
  /** Noms des contacts EMS, le ramasseur en premier (choisi par défaut). */
  ramasseurs: string[];
}

interface Row {
  key: number;
  brancheId: string;
  compagnie: EnvoiLine["compagnie"];
  designation: string;
  qnt: string;
  destination: string;
  observation: string;
}

/** Aperçu modifiable du bordereau : date, lignes (quantité, destination, observation), ajout d'une ligne libre, retrait d'une ligne, cachet. */
export function BordereauEditor({ initialLines, initialDate, ramasseurs }: Readonly<BordereauEditorProps>): React.JSX.Element {
  const counter = useRef(initialLines.length);
  const [date, setDate] = useState(initialDate);
  const [cachet, setCachet] = useState(true);
  // « 0 », « 1 »… : contact EMS de la liste ; « autre » : nom saisi (remplaçant) ; « vide » : ligne à remplir à la main.
  const [ramChoice, setRamChoice] = useState<string>(ramasseurs.length > 0 ? "0" : "vide");
  const [ramFree, setRamFree] = useState("");
  const ramasseur = ramChoice === "autre" ? ramFree : ramChoice === "vide" ? "" : (ramasseurs[Number(ramChoice)] ?? "");
  const [rows, setRows] = useState<Row[]>(() => initialLines.map((line, index) => ({ key: index, brancheId: line.brancheId, compagnie: line.compagnie, designation: line.designation, qnt: String(line.qnt), destination: line.destination, observation: line.observation })));

  const [remarque, setRemarque] = useState("");
  const [saved, setSaved] = useState<Envoi | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const payload = useMemo(
    () => ({
      date,
      ramasseur,
      remarque,
      lignes: rows.map((row) => ({ brancheId: row.brancheId, compagnie: row.compagnie, designation: row.designation, qnt: row.qnt.trim() === "" ? Number.NaN : Number(row.qnt), destination: row.destination, observation: row.observation })),
    }),
    [date, ramasseur, remarque, rows],
  );
  const checked = useMemo(() => envoiCreateSchema.safeParse(payload), [payload]);
  const total = checked.success ? checked.data.lignes.reduce((sum, line) => sum + line.qnt, 0) : rows.reduce((sum, row) => sum + (Number.parseInt(row.qnt, 10) || 0), 0);
  const groups = useMemo(() => groupByCompany(rows), [rows]);
  let lineNo = 0;
  const printHref = (numero: string): string => `/imprimer/bordereau?no=${encodeURIComponent(numero)}${cachet ? "" : "&cachet=0"}`;

  function save(): void {
    if (!checked.success || saved) return;
    setFailure(null);
    startTransition(async () => {
      const result = await createEnvoiAction(payload);
      if (result.success) {
        setSaved(result.data);
        // Selon le navigateur, l'ouverture automatique peut être bloquée : le lien « Imprimer » reste affiché.
        window.open(printHref(result.data.numero), "_blank", "noopener,noreferrer");
      } else setFailure(result.error);
    });
  }

  const update = (key: number, patch: Partial<Omit<Row, "key">>): void => setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  const add = (): void => {
    counter.current += 1;
    const key = counter.current;
    setRows((current) => [...current, { key, brancheId: "", compagnie: "", designation: "", qnt: "1", destination: "", observation: DEFAULT_OBSERVATION }]);
  };
  const remove = (key: number): void => setRows((current) => current.filter((row) => row.key !== key));

  return (
    <fieldset disabled={saved !== null || pending} className="flex min-w-0 flex-col gap-4 border-0 p-0">
      <div className="flex flex-col gap-3 rounded-lg border bg-card p-3 sm:flex-row sm:items-end">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bd-date">Date du bordereau</Label>
          <Input id="bd-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} className="sm:w-48" />
        </div>
        <p className="text-sm font-semibold sm:pb-2">{checked.success ? bordereauDateLabel(date) : "ALGER LE : —"}</p>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bd-ram">Ramasseur EMS</Label>
          <NativeSelect id="bd-ram" value={ramChoice} onChange={(event) => setRamChoice(event.target.value)} className="sm:w-56">
            {ramasseurs.map((nom, index) => (
              <option key={`${index}-${nom}`} value={String(index)}>
                {nom}
              </option>
            ))}
            <option value="autre">Autre (saisir un nom)</option>
            <option value="vide">Laisser vide</option>
          </NativeSelect>
        </div>
        {ramChoice === "autre" ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bd-ram-free">Nom du remplaçant</Label>
            <Input id="bd-ram-free" value={ramFree} onChange={(event) => setRamFree(event.target.value)} maxLength={80} autoComplete="off" className="sm:w-56" />
          </div>
        ) : null}
        <label className="flex items-center gap-2 text-sm sm:ml-auto sm:pb-2">
          <Checkbox checked={cachet} onChange={(event) => setCachet(event.target.checked)} />
          Zone « Cachet et signature »
        </label>
      </div>

      <p className="text-xs text-muted-foreground">À l&apos;impression, les lignes sont regroupées par compagnie (CAAT puis CAAR), avec un sous-total par compagnie. L&apos;ordre enregistré ne change pas.</p>
      <ul className="flex flex-col gap-3">
        {groups.map((group) => (
          <Fragment key={group.compagnie || "autres"}>
            {group.compagnie ? (
              <li className="flex items-center justify-between gap-2 rounded-md border-2 border-foreground px-3 py-1.5 text-sm font-bold" aria-label={`Compagnie ${group.compagnie}`}>
                <span>{sigleText(group.compagnie)}</span>
                <span>{subtotalLabel(group.compagnie, group.items.reduce((sum, row) => sum + (Number.parseInt(row.qnt, 10) || 0), 0))}</span>
              </li>
            ) : null}
            {group.items.map((row) => {
              lineNo += 1;
              const index = lineNo - 1;
              return (
          <li key={row.key} className="rounded-lg border bg-card p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-muted-foreground">Ligne {index + 1}</p>
              <button type="button" onClick={() => remove(row.key)} className="inline-flex items-center gap-1 text-sm font-medium text-destructive hover:underline" aria-label={`Retirer la ligne ${index + 1}`}>
                <Trash2 className="size-4" aria-hidden />
                Retirer
              </button>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-[2fr_6rem_2fr_3fr]">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`bd-des-${row.key}`}>Désignation</Label>
                <Input id={`bd-des-${row.key}`} value={row.designation} onChange={(event) => update(row.key, { designation: event.target.value })} placeholder="Autre destinataire" autoComplete="off" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`bd-qnt-${row.key}`}>Qnt</Label>
                <Input id={`bd-qnt-${row.key}`} type="number" min={1} max={9999} step={1} inputMode="numeric" value={row.qnt} onChange={(event) => update(row.key, { qnt: event.target.value })} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`bd-dst-${row.key}`}>Destination</Label>
                <Input id={`bd-dst-${row.key}`} value={row.destination} onChange={(event) => update(row.key, { destination: event.target.value })} autoComplete="off" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`bd-obs-${row.key}`}>Observation</Label>
                <Input id={`bd-obs-${row.key}`} value={row.observation} onChange={(event) => update(row.key, { observation: event.target.value })} autoComplete="off" />
              </div>
            </div>
          </li>
              );
            })}
          </Fragment>
        ))}
      </ul>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="bd-remarque">Remarque (facultative, conservée dans l&apos;historique)</Label>
        <Input id="bd-remarque" value={remarque} onChange={(event) => setRemarque(event.target.value)} maxLength={300} autoComplete="off" />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" onClick={add} disabled={rows.length >= 60}>
          <Plus />
          Ajouter une ligne
        </Button>
        <p className="text-sm font-semibold" aria-live="polite">
          Total : {total} pli(s)
        </p>
        <Button type="button" className="sm:ml-auto" onClick={save} disabled={!checked.success || saved !== null || pending}>
          <Save />
          {pending ? "Enregistrement…" : "Enregistrer et imprimer"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">Chaque bordereau est enregistré avec un numéro, sa date et son heure de création : il n&apos;y a pas d&apos;impression sans enregistrement.</p>
      {failure ? <Notice tone="error">{failure}</Notice> : null}
      {saved ? (
        <Notice tone="success">
          <p className="font-semibold">Bordereau {saved.numero} enregistré.</p>
          <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
            <a href={printHref(saved.numero)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium underline">
              <Printer className="size-4" aria-hidden />
              Imprimer le bordereau
            </a>
            <Link href="/adresses-courrier/historique" className="font-medium underline">
              Voir l&apos;historique et renseigner la date de ramassage
            </Link>
          </p>
        </Notice>
      ) : null}
      {checked.success || saved ? null : (
        <Notice tone="warning">{rows.length === 0 ? "Ajoutez au moins une ligne pour enregistrer le bordereau." : (checked.error.issues[0]?.message ?? "Vérifiez les champs du bordereau.")}</Notice>
      )}
    </fieldset>
  );
}
