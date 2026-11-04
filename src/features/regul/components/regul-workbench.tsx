"use client";

import { useRef, useState, useTransition } from "react";
import { Download, Upload } from "lucide-react";
import { analyseRegulAction } from "@/app/actions/regul-actions";
import { Notice } from "@/components/common/notice";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { REGUL_LABELS, REGUL_PERIODS, REGUL_SUCCURSALES } from "@/features/regul/services/regul-engine";
import type { RegulResult } from "@/features/regul/services/regul-service";
import { MONTHS_FR } from "@/utils/dates";
import { formatDA } from "@/utils/format";

type Saisie = Record<number, { total?: string; avance?: string }>;

const toNumber = (value: string | undefined): number | undefined => {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value.replace(/[\s ]/g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : undefined;
};

/** Poste de travail de la régularisation CAAT : fichiers, calcul, contrôles et export du classeur. */
export function RegulWorkbench({ defaultYear, canExport }: Readonly<{ defaultYear: number; canExport: boolean }>): React.JSX.Element {
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [succursale, setSuccursale] = useState<string>(REGUL_SUCCURSALES[0]);
  const [periode, setPeriode] = useState("T3");
  const [annee, setAnnee] = useState(String(defaultYear));
  const [saisies, setSaisies] = useState<Saisie>({});
  const [result, setResult] = useState<RegulResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function buildForm(): FormData {
    const form = new FormData();
    for (const file of files) form.append("files", file);
    form.set("succursale", succursale);
    form.set("periode", periode);
    form.set("annee", annee);
    const payload: Record<number, { total?: number; avance?: number }> = {};
    for (const [month, value] of Object.entries(saisies)) payload[Number(month)] = { total: toNumber(value.total), avance: toNumber(value.avance) };
    form.set("saisies", JSON.stringify(payload));
    return form;
  }

  function run(): void {
    setError(null);
    startTransition(async () => {
      const response = await analyseRegulAction(buildForm());
      if (!response.success) {
        setError(response.error);
        return;
      }
      setResult(response.data);
    });
  }

  function pick(list: FileList | null): void {
    setFiles(list ? Array.from(list) : []);
    setResult(null);
    setSaisies({});
  }

  function download(): void {
    setError(null);
    startTransition(async () => {
      const response = await fetch("/api/regul", { method: "POST", body: buildForm() });
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        setError(typeof body === "object" && body !== null && "error" in body ? String((body as { error: unknown }).error) : "L'export a échoué.");
        return;
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `REGUL_10_${succursale.replace(/ /g, "_")}_${periode}_${annee}.xlsx`;
      link.click();
      URL.revokeObjectURL(url);
    });
  }

  const a = result?.analysis;
  return (
    <div className="flex flex-col gap-4">
      <Card className="p-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field id="rg-succ" label="Succursale">
            <NativeSelect id="rg-succ" value={succursale} onChange={(e) => { setSuccursale(e.target.value); setResult(null); }}>
              {REGUL_SUCCURSALES.map((s) => (
                <option key={s} value={s}>
                  {REGUL_LABELS[s]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="rg-per" label="Période">
            <NativeSelect id="rg-per" value={periode} onChange={(e) => { setPeriode(e.target.value); setResult(null); }}>
              {Object.keys(REGUL_PERIODS).map((p) => (
                <option key={p} value={p}>
                  {p} ({(REGUL_PERIODS[p] ?? []).map((m) => MONTHS_FR[m - 1]?.slice(0, 4)).join(", ")})
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="rg-an" label="Année">
            <Input id="rg-an" value={annee} inputMode="numeric" onChange={(e) => { setAnnee(e.target.value); setResult(null); }} />
          </Field>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input ref={input} type="file" multiple accept=".xlsx,.xls,.xlsm,.csv" className="hidden" onChange={(e) => pick(e.target.files)} />
          <Button type="button" variant="outline" onClick={() => input.current?.click()}>
            <Upload /> Choisir les fichiers du trimestre
          </Button>
          <span className="text-sm text-muted-foreground">{files.length ? `${files.length} fichier(s) : ${files.map((f) => f.name).join(", ")}` : "Un fichier « arrêté comptablement » par mois (Excel ou CSV, 4 Mo au total)."}</span>
          <Button type="button" className="ml-auto" disabled={!files.length || pending} onClick={run}>
            {pending ? "Calcul…" : "Calculer"}
          </Button>
        </div>
      </Card>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {a ? (
        <>
          {a.nonLus.length ? <Notice tone="warning">Fichier(s) non lus (colonnes introuvables) : {a.nonLus.join(", ")}</Notice> : null}
          {a.fichiers.some((f) => f.hors) ? (
            <Notice tone="warning">Ignorés (mois hors période) : {a.fichiers.filter((f) => f.hors).map((f) => `${f.name} (${f.mois ? MONTHS_FR[f.mois - 1] : "mois non reconnu"})`).join(", ")}</Notice>
          ) : null}
          {a.sansFichier.length ? <Notice tone="warning">Aucun fichier pour : {a.sansFichier.map((m) => MONTHS_FR[m - 1]).join(", ")}. Le calcul porte sur les mois déposés.</Notice> : null}
          <div className="grid gap-2 sm:grid-cols-4">
            {[
              ["Montant régule", a.totals.regule],
              ["Avances reçues (90 % HT)", a.totals.avance],
              ["Écart 10 % HT", a.totals.ecart],
              ["Part Assisteur (écart + TVA)", a.totals.pa],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-lg border bg-card p-3">
                <span className="block text-xs text-muted-foreground">{label}</span>
                <span className="block text-lg font-semibold tabular-nums">{formatDA(Number(value))}</span>
              </div>
            ))}
          </div>
          <Card className="overflow-x-auto p-0">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="bg-muted/50 text-xs">
                  <th className="px-2 py-2 text-left">Mois</th>
                  <th className="px-2 py-2 text-right">Montant total</th>
                  <th className="px-2 py-2 text-right">Avance reçue</th>
                  <th className="px-2 py-2 text-right">Régule (fichiers)</th>
                  <th className="px-2 py-2 text-right">Écart 10 % HT</th>
                  <th className="px-2 py-2 text-right">TVA 19 %</th>
                  <th className="px-2 py-2 text-right">Part Assisteur</th>
                </tr>
              </thead>
              <tbody>
                {a.rows.map((r) => (
                  <tr key={r.m} className="border-t">
                    <td className="px-2 py-1.5">{MONTHS_FR[r.m - 1]}{r.fichier ? "" : " (sans fichier)"}</td>
                    <td className="px-1 py-1 text-right">
                      <Input className="h-8 w-36 text-right" inputMode="decimal" placeholder={formatDA(r.total)} value={saisies[r.m]?.total ?? ""} onChange={(e) => setSaisies((s) => ({ ...s, [r.m]: { ...s[r.m], total: e.target.value } }))} />
                    </td>
                    <td className="px-1 py-1 text-right">
                      <Input className="h-8 w-36 text-right" inputMode="decimal" placeholder={formatDA(r.avance)} value={saisies[r.m]?.avance ?? ""} onChange={(e) => setSaisies((s) => ({ ...s, [r.m]: { ...s[r.m], avance: e.target.value } }))} />
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{formatDA(r.regule)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{formatDA(r.ecart)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{formatDA(r.tva)}</td>
                    <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{formatDA(r.pa)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 bg-muted/50 font-semibold">
                  <td className="px-2 py-2">Total {a.periode} {a.annee}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{formatDA(a.totals.total)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{formatDA(a.totals.avance)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{formatDA(a.totals.regule)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{formatDA(a.totals.ecart)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{formatDA(a.totals.tva)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{formatDA(a.totals.pa)}</td>
                </tr>
              </tfoot>
            </table>
          </Card>
          <p className="text-xs text-muted-foreground">
            Les avances sont reprises des factures d&apos;avance CAAT d&apos;AssistPay{Object.keys(result.avancesFactures).length ? "" : " (aucune trouvée pour cette succursale et cette année)"}. Saisissez un montant dans une case pour le corriger (relevé bancaire fait foi), puis cliquez sur Calculer.
          </p>
          <div className="grid gap-2 sm:grid-cols-4 text-sm">
            <div className="rounded-lg border p-3"><b>{a.valid.length}</b> polices valides</div>
            <div className="rounded-lg border p-3"><b>{a.annul.length}</b> annulations ({a.annul.filter((x) => !x.plus).length} sans ligne positive dans la période)</div>
            <div className="rounded-lg border p-3"><b>{a.garan.length}</b> changements de garantie</div>
            <div className="rounded-lg border p-3"><b>{a.flottes.length}</b> flotte(s) décalée(s) · {a.illisibles} immat. illisible(s)</div>
          </div>
          {a.annul.length ? (
            <Card className="overflow-x-auto p-0">
              <div className="border-b px-3 py-2 text-sm font-semibold">Annulations à contrôler{a.annul.length > 100 ? " (100 premières, toutes dans le classeur)" : ""}</div>
              <table className="w-full min-w-[820px] text-sm">
                <thead>
                  <tr className="bg-muted/50 text-xs">
                    <th className="px-2 py-1.5 text-left">Mois</th>
                    <th className="px-2 py-1.5 text-left">Police</th>
                    <th className="px-2 py-1.5 text-left">Immatriculation</th>
                    <th className="px-2 py-1.5 text-left">Agence</th>
                    <th className="px-2 py-1.5 text-right">Prime</th>
                    <th className="px-2 py-1.5 text-right">Part Assisteur</th>
                    <th className="px-2 py-1.5 text-left">Ligne positive ?</th>
                  </tr>
                </thead>
                <tbody>
                  {a.annul.slice(0, 100).map((x, i) => (
                    <tr key={`${x.police}-${x.immat}-${i}`} className="border-t">
                      <td className="px-2 py-1">{MONTHS_FR[x.m - 1]}</td>
                      <td className="px-2 py-1">{x.police}</td>
                      <td className="px-2 py-1">{x.immat}</td>
                      <td className="px-2 py-1">{x.agence}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{formatDA(x.prime)}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{formatDA(x.pa)}</td>
                      <td className="px-2 py-1">{x.plus ? "Oui" : "Non (avant la période)"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          ) : null}
          <Card className="overflow-x-auto p-0">
            <div className="border-b px-3 py-2 text-sm font-semibold">Production par agence (fichiers déposés)</div>
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="bg-muted/50 text-xs">
                  <th className="px-2 py-1.5 text-left">Agence</th>
                  {a.months.map((m) => (
                    <th key={m} className="px-2 py-1.5 text-right">{MONTHS_FR[m - 1]}</th>
                  ))}
                  <th className="px-2 py-1.5 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {a.agences.map((ag) => (
                  <tr key={ag.code} className="border-t">
                    <td className="px-2 py-1">{ag.code} {ag.nom}</td>
                    {ag.mois.map((c) => (
                      <td key={c.m} className={`px-2 py-1 text-right tabular-nums ${c.n === 0 ? "text-destructive" : ""}`}>{c.n ? formatDA(c.pa) : "absente"}</td>
                    ))}
                    <td className="px-2 py-1 text-right font-semibold tabular-nums">{formatDA(ag.mois.reduce((s, c) => s + c.pa, 0))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          {canExport ? (
            <div>
              <Button type="button" disabled={pending} onClick={download}>
                <Download /> Exporter le classeur Excel
              </Button>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
