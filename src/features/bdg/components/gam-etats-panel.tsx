"use client";

import { useState, useTransition } from "react";
import { Download, Printer } from "lucide-react";
import { exportGamEtatsAction, previewGamEtatsAction } from "@/app/actions/bdg-actions";
import { FileDrop } from "@/components/common/file-drop";
import { Notice } from "@/components/common/notice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import type { GamEtats } from "@/features/bdg/services/gam-etats";
import { cn } from "@/utils/cn";
import { formatDA } from "@/utils/format";

const MOIS = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];

function download(filename: string, base64: string): void {
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/**
 * BDG GAM : on dépose l'Excel des factures, les factures sont réparties par agence, la TVA et le TTC calculés,
 * puis on imprime ou télécharge l'état de chaque agence et le récapitulatif général.
 */
export function GamEtatsPanel(): React.JSX.Element {
  const [file, setFile] = useState<File | null>(null);
  const [tva, setTva] = useState("19");
  const [exclure, setExclure] = useState("Préstation; Frais de gestion");
  const [mois, setMois] = useState("");
  const [etats, setEtats] = useState<GamEtats | null>(null);
  const [current, setCurrent] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function form(source: File): FormData {
    const data = new FormData();
    data.set("file", source);
    data.set("tva", tva);
    data.set("exclure", exclure);
    data.set("mois", mois);
    return data;
  }

  function run(source: File): void {
    setError(null);
    startTransition(async () => {
      const result = await previewGamEtatsAction(form(source));
      if (!result.success) {
        setEtats(null);
        setError(result.error);
        return;
      }
      setEtats(result.data);
      setMois(String(result.data.mois));
      setCurrent(-1);
    });
  }

  function exportExcel(): void {
    if (!file) return;
    startTransition(async () => {
      const result = await exportGamEtatsAction(form(file));
      if (result.success) download(result.data.filename, result.data.base64);
      else setError(result.error);
    });
  }

  function print(): void {
    document.body.dataset.print = "gam";
    const clear = (): void => {
      delete document.body.dataset.print;
      window.removeEventListener("afterprint", clear);
    };
    window.addEventListener("afterprint", clear);
    window.print();
  }

  const pc = etats ? `TVA ${Number(etats.tauxTva.toFixed(2))} %` : "TVA";
  const agency = etats && current >= 0 ? etats.agencies[current] : null;
  const totalBox = (ht: number, tvaAmount: number, ttc: number): React.JSX.Element => (
    <table className="mt-4 ml-auto w-72 border-collapse text-sm">
      <tbody>
        {[
          ["TOTAL HT", ht],
          [pc, tvaAmount],
          ["TOTAL TTC", ttc],
        ].map(([label, value], index) => (
          <tr key={String(label)} className={cn("font-semibold", index === 2 && "bg-[#fff2cc]")}>
            <td className="border border-neutral-800 px-3 py-1.5 text-center">{label}</td>
            <td className="border border-neutral-800 px-3 py-1.5 text-right tabular-nums">{formatDA(Number(value))}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Déposez le fichier Excel des factures GAM (colonnes Agence, N° de dossier, Prix HT, Date). Chaque agence reçoit son état avec total HT, TVA et TTC, plus un récapitulatif général prêt à imprimer ou à télécharger. Rien n&apos;est enregistré dans la base.
      </p>
      <div className="grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-3">
        <label className="text-sm">
          Taux de TVA (%)
          <Input type="number" min={0} max={100} step={0.5} value={tva} onChange={(event) => setTva(event.target.value)} />
        </label>
        <label className="text-sm sm:col-span-2">
          Colonnes à ne pas reprendre
          <Input value={exclure} onChange={(event) => setExclure(event.target.value)} />
        </label>
        <div className="sm:col-span-3">
          <FileDrop
            label={file ? file.name : "Cliquez ici ou déposez le fichier des factures (.xlsx, .xlsm)"}
            hint="Le fichier n'est pas conservé."
            disabled={pending}
            onFile={(next) => {
              setFile(next);
              run(next);
            }}
          />
        </div>
      </div>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {pending && !etats ? <p className="text-sm text-muted-foreground">Traitement du fichier…</p> : null}
      {etats ? (
        <>
          <div className="flex flex-col gap-1">
            {etats.controls.map((control) => (
              <Notice key={control.text} tone={control.tone === "err" ? "error" : control.tone === "warn" ? "warning" : "success"}>
                {control.text}
              </Notice>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm">
              Mois du récapitulatif
              <NativeSelect
                value={mois}
                onChange={(event) => {
                  setMois(event.target.value);
                }}
              >
                {MOIS.map((name, index) => (
                  <option key={name} value={index + 1}>
                    {name}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <Button type="button" variant="outline" disabled={pending || !file} onClick={() => file && run(file)}>
              Recalculer
            </Button>
            <Button type="button" disabled={pending || !file} onClick={exportExcel}>
              <Download />
              Excel (tous les états)
            </Button>
            <Button type="button" variant="outline" onClick={print}>
              <Printer />
              Imprimer cet état
            </Button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {[{ name: "Récapitulatif général", index: -1 }, ...etats.agencies.map((a, index) => ({ name: a.name, index }))].map((tab) => (
              <button
                key={tab.index}
                type="button"
                onClick={() => setCurrent(tab.index)}
                className={cn("rounded-md border px-3 py-1.5 text-sm", tab.index === current ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted")}
              >
                {tab.name}
              </button>
            ))}
          </div>
          <div className="gam-etat overflow-x-auto rounded-lg border bg-white p-6 text-neutral-900">
            <h3 className="mb-4 text-center text-lg font-bold">{agency ? etats.titre : etats.titreGeneral}</h3>
            {agency ? (
              <>
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr>
                      {etats.columns.map((column, index) => (
                        <th key={`${column}-${index}`} className="border border-neutral-800 bg-[#d9e1f2] px-2 py-1.5">
                          {column}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {agency.rows.map((row) => (
                      <tr key={row.line}>
                        {row.cells.map((cell, index) =>
                          index === etats.htIndex ? (
                            <td key={index} className={cn("border border-neutral-800 px-2 py-1 text-right tabular-nums", row.amount === null && "bg-[#ffc7ce] text-[#9c0006]")}>
                              {row.amount === null ? row.raw : formatDA(row.amount)}
                            </td>
                          ) : (
                            <td key={index} className="border border-neutral-800 px-2 py-1 text-center">
                              {cell}
                            </td>
                          ),
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {totalBox(agency.ht, agency.tva, agency.ttc)}
              </>
            ) : (
              <>
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr>
                      {["N°", "Agence", "Nombre de factures", "TOTAL HT", pc, "TOTAL TTC"].map((column) => (
                        <th key={column} className="border border-neutral-800 bg-[#d9e1f2] px-2 py-1.5">
                          {column}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {etats.agencies.map((a, index) => (
                      <tr key={a.name}>
                        <td className="border border-neutral-800 px-2 py-1 text-center">{index + 1}</td>
                        <td className="border border-neutral-800 px-2 py-1">{a.name}</td>
                        <td className="border border-neutral-800 px-2 py-1 text-center">{a.rows.length}</td>
                        <td className="border border-neutral-800 px-2 py-1 text-right tabular-nums">{formatDA(a.ht)}</td>
                        <td className="border border-neutral-800 px-2 py-1 text-right tabular-nums">{formatDA(a.tva)}</td>
                        <td className="border border-neutral-800 px-2 py-1 text-right tabular-nums">{formatDA(a.ttc)}</td>
                      </tr>
                    ))}
                    <tr className="bg-[#ffd966] font-bold">
                      <td className="border border-neutral-800 px-2 py-1" />
                      <td className="border border-neutral-800 px-2 py-1">TOTAL GÉNÉRAL</td>
                      <td className="border border-neutral-800 px-2 py-1 text-center">{etats.totals.n}</td>
                      <td className="border border-neutral-800 px-2 py-1 text-right tabular-nums">{formatDA(etats.totals.ht)}</td>
                      <td className="border border-neutral-800 px-2 py-1 text-right tabular-nums">{formatDA(etats.totals.tva)}</td>
                      <td className="border border-neutral-800 px-2 py-1 text-right tabular-nums">{formatDA(etats.totals.ttc)}</td>
                    </tr>
                  </tbody>
                </table>
                {totalBox(etats.totals.ht, etats.totals.tva, etats.totals.ttc)}
              </>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
