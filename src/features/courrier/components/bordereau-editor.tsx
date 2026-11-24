"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Plus, Printer, Trash2 } from "lucide-react";
import { Notice } from "@/components/common/notice";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { bordereauDateLabel, bordereauHref, totalPlis } from "@/features/courrier/lib/bordereau";
import { bordereauQuerySchema } from "@/features/courrier/schemas";
import { DEFAULT_OBSERVATION, type BordereauLine } from "@/features/courrier/types";
import { cn } from "@/utils/cn";

/** Propriétés de l'éditeur de bordereau. */
export interface BordereauEditorProps {
  initialLines: BordereauLine[];
  /** Date du jour `AAAA-MM-JJ` (fuseau d'Alger), calculée côté serveur. */
  initialDate: string;
}

interface Row {
  key: number;
  designation: string;
  qnt: string;
  destination: string;
  observation: string;
}

/** Aperçu modifiable du bordereau : date, lignes (quantité, destination, observation), ajout d'une ligne libre, retrait d'une ligne, cachet. */
export function BordereauEditor({ initialLines, initialDate }: Readonly<BordereauEditorProps>): React.JSX.Element {
  const counter = useRef(initialLines.length);
  const [date, setDate] = useState(initialDate);
  const [cachet, setCachet] = useState(true);
  const [rows, setRows] = useState<Row[]>(() => initialLines.map((line, index) => ({ key: index, designation: line.designation, qnt: String(line.qnt), destination: line.destination, observation: line.observation })));

  const checked = useMemo(
    () =>
      bordereauQuerySchema.safeParse({
        date,
        cachet: cachet ? "1" : "0",
        des: rows.map((row) => row.designation),
        qnt: rows.map((row) => row.qnt),
        dst: rows.map((row) => row.destination),
        obs: rows.map((row) => row.observation),
      }),
    [date, cachet, rows],
  );
  const lines: BordereauLine[] = checked.success ? checked.data.des.map((designation, index) => ({ designation, qnt: checked.data.qnt[index] ?? 1, destination: checked.data.dst[index] ?? "", observation: checked.data.obs[index] ?? "" })) : [];
  const total = checked.success ? totalPlis(lines) : rows.reduce((sum, row) => sum + (Number.parseInt(row.qnt, 10) || 0), 0);

  const update = (key: number, patch: Partial<Omit<Row, "key">>): void => setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  const add = (): void => {
    counter.current += 1;
    const key = counter.current;
    setRows((current) => [...current, { key, designation: "", qnt: "1", destination: "", observation: DEFAULT_OBSERVATION }]);
  };
  const remove = (key: number): void => setRows((current) => current.filter((row) => row.key !== key));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-lg border bg-card p-3 sm:flex-row sm:items-end">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bd-date">Date du bordereau</Label>
          <Input id="bd-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} className="sm:w-48" />
        </div>
        <p className="text-sm font-semibold sm:pb-2">{checked.success ? bordereauDateLabel(date) : "ALGER LE : —"}</p>
        <label className="flex items-center gap-2 text-sm sm:ml-auto sm:pb-2">
          <Checkbox checked={cachet} onChange={(event) => setCachet(event.target.checked)} />
          Zone « Cachet et signature »
        </label>
      </div>

      <ul className="flex flex-col gap-3">
        {rows.map((row, index) => (
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
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" onClick={add} disabled={rows.length >= 60}>
          <Plus />
          Ajouter une ligne
        </Button>
        <p className="text-sm font-semibold" aria-live="polite">
          Total : {total} pli(s)
        </p>
        {checked.success ? (
          <Link href={bordereauHref({ date, cachet, lines })} target="_blank" rel="noopener noreferrer" className={cn(buttonVariants(), "sm:ml-auto")}>
            <Printer />
            Imprimer le bordereau
          </Link>
        ) : (
          <span aria-disabled="true" className={cn(buttonVariants(), "pointer-events-none opacity-50 sm:ml-auto")}>
            <Printer />
            Imprimer le bordereau
          </span>
        )}
      </div>
      {checked.success ? null : (
        <Notice tone="warning">{rows.length === 0 ? "Ajoutez au moins une ligne pour imprimer le bordereau." : (checked.error.issues[0]?.message ?? "Vérifiez les champs du bordereau.")}</Notice>
      )}
    </div>
  );
}
