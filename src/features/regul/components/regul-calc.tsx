"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { regulWorkDataAction, saveResultsAction, saveSaisieAction } from "@/app/actions/regul-actions";
import { Notice } from "@/components/common/notice";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { downloadBytes, f0, fm, parseAmount } from "@/features/regul/components/regul-format";
import { zipBuffer, zipList } from "@/features/regul/lib/zip-reader";
import {
  analyse,
  calc,
  parseRegulFile,
  REGUL_LABELS,
  REGUL_MOIS,
  REGUL_PERIODS,
  REGUL_SUCCURSALES,
  topAgencies,
  succId,
  type BaseRow,
  type RegulFile,
  type RegulIndex,
  type RegulSin,
  type Saisie,
} from "@/features/regul/services/regul-engine";
import { writeRegulWorkbook } from "@/features/regul/services/regul-export";
import { readCsvRows, readWorkbook } from "@/lib/spreadsheet";
import { cn } from "@/utils/cn";

interface Props {
  index: RegulIndex | null;
  sinMeta: { jusqua: string; maj: string; dossiers: number; cles: number } | null;
  canEdit: boolean;
  canExport: boolean;
  initialSucc: string;
  onSaved: () => void;
}

const YEAR = 2026;
const ZIP_OK = /\.(csv|txt|xlsx|xls|xlsm)$/i;

/** Onglet « Régulariser » : succursale, période, dépôt des fichiers, calcul 10 % + TVA, contrôles et export. */
export function RegulCalc({ index, sinMeta, canEdit, canExport, initialSucc, onSaved }: Readonly<Props>): React.JSX.Element {
  const input = useRef<HTMLInputElement>(null);
  const [succ, setSucc] = useState(initialSucc);
  const [per, setPer] = useState("T3");
  const [files, setFiles] = useState<RegulFile[]>([]);
  const [base, setBase] = useState<BaseRow[]>([]);
  const [sinKeys, setSinKeys] = useState<string[] | null>(null);
  const [saisies, setSaisies] = useState<Record<string, Saisie>>({});
  const [loadedFor, setLoadedFor] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ tone: "info" | "error" | "success" | "warning"; text: string } | null>(null);
  const [over, setOver] = useState(false);
  const [pending, startTransition] = useTransition();

  const sinSet = useMemo(() => (sinKeys ? new Set(sinKeys) : null), [sinKeys]);
  const sinForExport: RegulSin | null = sinMeta && sinKeys ? { keys: sinKeys, jusqua: sinMeta.jusqua, maj: sinMeta.maj, dossiers: sinMeta.dossiers } : null;

  const load = useCallback(async (s: string): Promise<void> => {
    if (!s) return;
    setLoading(true);
    const res = await regulWorkDataAction({ succursale: s });
    setLoading(false);
    if (!res.success) {
      setMsg({ tone: "error", text: res.error });
      return;
    }
    setBase(res.data.base);
    setSinKeys(res.data.sinKeys);
    setSaisies(res.data.saisies);
    setLoadedFor(s);
  }, []);

  useEffect(() => {
    if (succ && loadedFor !== succ) void load(succ);
  }, [succ, loadedFor, load]);

  async function addFiles(list: FileList | File[]): Promise<void> {
    const expanded: File[] = [];
    for (const f of Array.from(list)) {
      if (!/\.zip$/i.test(f.name)) {
        expanded.push(f);
        continue;
      }
      try {
        let n = 0;
        for (const e of await zipList(f)) {
          const name = e.name.split("/").pop() ?? "";
          if (!name || e.name.endsWith("/") || e.name.startsWith("__MACOSX") || name.startsWith("~$") || name.startsWith(".") || !ZIP_OK.test(name)) continue;
          expanded.push(new File([await zipBuffer(f, e)], name));
          n++;
        }
        if (!n) setMsg({ tone: "warning", text: `« ${f.name} » : aucun fichier CSV ou Excel dans ce zip.` });
      } catch (error) {
        setMsg({ tone: "error", text: `« ${f.name} » : ${error instanceof Error ? error.message : "zip illisible"}` });
      }
    }
    const next = [...files];
    for (const f of expanded) {
      try {
        const bytes = new Uint8Array(await f.arrayBuffer());
        const sheets = /\.(csv|txt)$/i.test(f.name) ? [{ name: f.name, rows: readCsvRows(bytes) }] : readWorkbook(bytes);
        const parsed = parseRegulFile(f.name, f.size, sheets, YEAR);
        if (!parsed) throw new Error("colonnes IMMATRICULATION / POLICE / PRIME / PART_ASSISTEUR introuvables");
        const at = next.findIndex((x) => x.id === parsed.id);
        if (at >= 0) next.splice(at, 1);
        next.push(parsed);
      } catch (error) {
        setMsg({ tone: "error", text: `« ${f.name} » : ${error instanceof Error ? error.message : "fichier illisible"}` });
      }
    }
    const ms = [...new Set(next.map((f) => f.mois).filter(Boolean))];
    if (ms.length && !ms.every((m) => (REGUL_PERIODS[per] ?? []).includes(m))) {
      const fit = Object.keys(REGUL_PERIODS).find((k) => k !== "S1" && ms.every((m) => (REGUL_PERIODS[k] ?? []).includes(m))) ?? Object.keys(REGUL_PERIODS).find((k) => ms.every((m) => (REGUL_PERIODS[k] ?? []).includes(m)));
      if (fit) setPer(fit);
    }
    setFiles(next);
  }

  const months = REGUL_PERIODS[per] ?? [];
  const ready = Boolean(succ) && files.some((f) => months.includes(f.mois));
  const A = useMemo(() => (ready ? analyse(succ, per, files, base, sinSet, index) : null), [ready, succ, per, files, base, sinSet, index]);
  const C = useMemo(() => (A ? calc(A, YEAR, index, saisies) : null), [A, index, saisies]);

  function editAmount(key: string, field: "total" | "avance", raw: string): void {
    if (!canEdit) {
      setMsg({ tone: "warning", text: "Vous avez un accès en consultation uniquement." });
      return;
    }
    const value = parseAmount(raw);
    setSaisies((s) => ({ ...s, [key]: { ...(s[key] ?? { succ }), succ, [field]: value } }));
    startTransition(async () => {
      const res = await saveSaisieAction({ key, succursale: succ, field, value });
      if (!res.success) setMsg({ tone: "error", text: res.error });
    });
  }

  function exportXlsx(): void {
    if (!A) return;
    try {
      downloadBytes(`Regule_10_TVA_${succ.replace(/ /g, "")}_${per}_${YEAR}.xlsx`, writeRegulWorkbook(A, per, YEAR, index, saisies, sinForExport));
    } catch {
      setMsg({ tone: "error", text: "Le fichier n'a pas pu être créé." });
    }
  }

  function save(): void {
    if (!A || !C) return;
    const results = C.rows
      .filter((r) => r.hasFile)
      .map((r) => ({
        key: `${succId(A.s)}-${YEAR}-${String(r.m).padStart(2, "0")}`,
        succ: A.s,
        mois: r.m,
        annee: YEAR,
        total: r.total,
        avance: r.avance,
        regule: r.regule,
        ecart: r.ecart,
        tva: r.tva,
        pa: r.pa,
        base: Math.round((A.baseM[r.m]?.pa ?? 0) * 100) / 100,
        top: topAgencies(A, r.m),
        fichiers: A.files.filter((f) => f.mois === r.m).map((f) => f.name),
        maj: "",
      }));
    startTransition(async () => {
      const res = await saveResultsAction({ resume: `${REGUL_LABELS[A.s]} ${per} ${YEAR} : Part Assisteur ${fm(C.tot.pa)} DA`, results });
      if (!res.success) setMsg({ tone: "error", text: res.error });
      else {
        setMsg({ tone: "success", text: "Résultat enregistré dans le suivi." });
        onSaved();
      }
    });
  }

  const alerts: string[] = [];
  const nbMois = A ? new Set(A.files.map((f) => f.mois)).size : 0;
  const parAgence = new Map<number, { nom: string; mois: number[]; pa: number }>();
  for (const x of A?.manquantes ?? []) {
    const cur = parAgence.get(x.code) ?? { nom: x.nom, mois: [], pa: 0 };
    cur.mois.push(x.m);
    cur.pa += x.basePa;
    parAgence.set(x.code, cur);
  }
  const absentes = [...parAgence.entries()].filter(([, v]) => nbMois > 0 && v.mois.length >= nbMois);
  const codesAbsents = new Set(absentes.map(([code]) => code));
  const partielles = (A?.manquantes ?? []).filter((x) => !codesAbsents.has(x.code));
  if (A && C) {
    const nonCred = C.rows.filter((r) => /non/i.test(r.statut));
    if (nonCred.length) alerts.push(`Avance non créditée selon le TCD : ${nonCred.map((r) => (REGUL_MOIS[r.m - 1] ?? "").toLowerCase()).join(", ")} — à vérifier avec le relevé bancaire.`);
    if (partielles.length) alerts.push(`Agences présentes dans le consolidé et absentes de certains mois : ${partielles.map((x) => `${x.code} (${(REGUL_MOIS[x.m - 1] ?? "").toLowerCase()}, ${fm(x.basePa)} DA au consolidé)`).join(" ; ")}.`);
    if (A.nouvelles.length) alerts.push(`Agence(s) nouvelle(s), jamais vue(s) auparavant : ${A.nouvelles.map((a) => `${a.code} ${a.nom}`).join(" ; ")}.`);
    if (A.onlyFile.length || A.onlyBase.length) alerts.push(`Écart ligne à ligne avec le consolidé : ${A.onlyFile.length} ligne(s) seulement dans les fichiers, ${A.onlyBase.length} seulement dans le consolidé (détail dans l'export).${A.immatDiff ? ` ${A.immatDiff} autre(s) ligne(s) identiques mais avec une immatriculation différente ou absente d'un côté.` : ""}`);
    else if (A.immatDiff) alerts.push(`${A.immatDiff} ligne(s) identiques au consolidé (police, prime, part assisteur) mais avec une immatriculation différente ou absente d'un côté.`);
    if (A.flottes.length) alerts.push(`${A.flottes.length} police(s) de flotte sur plusieurs mois (flotte décalée possible).`);
    if (A.horsMois) alerts.push(`${f0(A.horsMois)} ligne(s) dont la date d'émission n'est pas dans le mois du fichier.`);
    if (A.illisibles) alerts.push(`${A.illisibles} immatriculation(s) illisible(s) dans la source.`);
    if (!sinKeys) alerts.push("Base sinistres non chargée : le croisement annulations / sinistres n'est pas fait.");
    if (!A.baseN) alerts.push("Aucune ligne de cette succursale dans la base de production : pas de comparaison possible.");
  }
  const sins = A ? A.annul.filter((x) => x.sinistre) : [];
  const th = "px-2 py-1.5 text-xs font-semibold";

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-4">
        <h3 className="mb-1 font-semibold">Régulariser une succursale</h3>
        <p className="mb-3 text-sm text-muted-foreground">Choisissez la succursale, déposez le zip reçu (ou les fichiers mensuels « arrêté comptablement ») : le calcul se lance seul.</p>
        <div className="grid max-w-2xl gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            Succursale
            <NativeSelect value={succ} onChange={(e) => setSucc(e.target.value)}>
              <option value="">— choisir —</option>
              {REGUL_SUCCURSALES.map((s) => (
                <option key={s} value={s}>
                  {REGUL_LABELS[s]}
                </option>
              ))}
            </NativeSelect>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Période
            <NativeSelect value={per} onChange={(e) => setPer(e.target.value)}>
              {Object.keys(REGUL_PERIODS).map((p) => (
                <option key={p} value={p}>
                  {p === "S1" ? "Semestre 1" : `Trimestre ${p[1]}`} ({(REGUL_PERIODS[p] ?? []).map((m) => `${(REGUL_MOIS[m - 1] ?? "").slice(0, 4).toLowerCase()}.`).join(", ")})
                </option>
              ))}
            </NativeSelect>
          </label>
        </div>
        <input ref={input} type="file" multiple accept=".csv,.txt,.xlsx,.xls,.xlsm,.zip" className="hidden" onChange={(e) => { if (e.target.files) void addFiles(e.target.files); e.target.value = ""; }} />
        <button
          type="button"
          onClick={() => input.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); void addFiles(e.dataTransfer.files); }}
          className={cn("mt-4 w-full rounded-lg border-2 border-dashed p-6 text-center", over && "border-primary")}
        >
          <b>Déposez ici le zip ou les fichiers du trimestre</b>
          <span className="block text-xs text-muted-foreground">un fichier par mois, CSV ou Excel (onglet DETAIL), ou le zip tel que reçu ; le mois est lu dans le nom du fichier ou dans les dates d&apos;émission</span>
        </button>
        {files.length ? (
          <div className="mt-3 flex flex-col gap-2 text-sm">
            {files.map((f, i) => (
              <div key={f.id} className="flex flex-wrap items-center gap-3">
                <b>{f.name}</b>
                <span>{f0(f.lignes.length)} lignes · {fm(f.lignes.reduce((a, l) => a + l.pa, 0))} DA</span>
                <label className="flex items-center gap-1">
                  Mois
                  <NativeSelect className="h-8 w-40" value={f.mois} onChange={(e) => setFiles((list) => list.map((x, j) => (j === i ? { ...x, mois: Number(e.target.value) } : x)))}>
                    {[0, ...Array.from({ length: 12 }, (_, k) => k + 1)].map((m) => (
                      <option key={m} value={m}>{m ? REGUL_MOIS[m - 1] : "— à choisir —"}</option>
                    ))}
                  </NativeSelect>
                </label>
                {months.includes(f.mois) ? null : <span className="rounded-full bg-warning/20 px-2 py-0.5 text-xs">hors période</span>}
                {f.moisFichier && f.moisEmission && f.moisFichier !== f.moisEmission ? <span className="rounded-full bg-warning/20 px-2 py-0.5 text-xs">dates d&apos;émission : {REGUL_MOIS[f.moisEmission - 1]}</span> : null}
                <Button type="button" size="sm" variant="outline" onClick={() => setFiles((list) => list.filter((_, j) => j !== i))}>Retirer</Button>
              </div>
            ))}
          </div>
        ) : null}
      </Card>
      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
      {!succ ? <p className="text-sm text-muted-foreground">Choisissez la succursale pour lancer le contrôle.</p> : !ready ? <p className="text-sm text-muted-foreground">Déposez au moins un fichier de la période pour lancer le calcul.</p> : loading || loadedFor !== succ ? <p className="text-sm text-muted-foreground">Analyse en cours…</p> : null}
      {A && C && loadedFor === succ ? (
        <>
          <div className="grid gap-2 sm:grid-cols-5">
            {[
              ["Lignes lues", f0(A.L.length), ""],
              ["Valides", f0(A.valid.length), ""],
              ["Vraies annulations", f0(A.annul.length), sinKeys ? `${sins.length} avec sinistre` : "base sinistres non chargée"],
              ["Changements de garantie", f0(A.garan.length), ""],
              ["Part Assisteur à facturer", fm(C.tot.pa), ""],
            ].map(([k, v, h]) => (
              <div key={k} className="rounded-lg border bg-card p-3">
                <span className="block text-xs text-muted-foreground">{k}</span>
                <span className="block text-lg font-semibold tabular-nums">{v}</span>
                {h ? <span className="block text-xs text-muted-foreground">{h}</span> : null}
              </div>
            ))}
          </div>
          <h3 className="font-semibold">Régularisation 10 % + TVA</h3>
          <Card className="overflow-x-auto p-0">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="bg-muted/50">
                  <th className={cn(th, "text-left")}>Mois</th>
                  {["Montant Total", "Somme Avance", "Montant Régule", "ECARTS 10% HT", "TVA 19%", "Part Assisteur"].map((h) => (
                    <th key={h} className={cn(th, "text-right")}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {C.rows.map((r) => (
                  <tr key={r.m} className="border-t">
                    <td className="px-2 py-1.5">
                      <b>{REGUL_MOIS[r.m - 1]}</b>
                      {r.statut ? <span className={cn("block text-xs", /non/i.test(r.statut) ? "text-destructive" : "text-muted-foreground")}>{r.statut}</span> : null}
                      {r.hasFile ? null : <span className="block text-xs text-destructive">fichier manquant</span>}
                    </td>
                    {(["total", "avance"] as const).map((field) => (
                      <td key={field} className="px-1 py-1 text-right">
                        <Input key={`${r.key}-${field}-${r[field]}`} className="h-8 w-36 text-right" inputMode="decimal" defaultValue={fm(r[field])} onBlur={(e) => { if (parseAmount(e.target.value) !== r[field]) editAmount(r.key, field, e.target.value); }} />
                      </td>
                    ))}
                    <td className="px-2 py-1.5 text-right tabular-nums">{fm(r.regule)}</td>
                    <td className={cn("px-2 py-1.5 text-right tabular-nums", r.ecart < 0 && "text-destructive")}>{fm(r.ecart)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{fm(r.tva)}</td>
                    <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{fm(r.pa)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 bg-muted/50 font-semibold">
                  <td className="px-2 py-2">TOTAL {per} {YEAR}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{fm(C.tot.total)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{fm(C.tot.avance)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{fm(C.tot.regule)}</td>
                  <td className={cn("px-2 py-2 text-right tabular-nums", C.tot.ecart < 0 && "text-destructive")}>{fm(C.tot.ecart)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{fm(C.tot.tva)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{fm(C.tot.pa)}</td>
                </tr>
              </tbody>
            </table>
          </Card>
          <p className="text-xs text-muted-foreground">Montant Total et Somme Avance viennent du TCD du consolidé ; vous pouvez les corriger (virement confirmé par la banque) : le calcul se met à jour.</p>
          <h3 className="font-semibold">Points à contrôler</h3>
          {absentes.length ? (
            <Notice tone="error" className="mb-2">
              <p className="font-semibold">{absentes.length === 1 ? "Une agence est entièrement absente des fichiers reçus" : `${absentes.length} agences sont entièrement absentes des fichiers reçus`}</p>
              <ul className="mt-1 list-disc pl-5">
                {absentes.map(([code, v]) => (
                  <li key={code}>
                    {code} {v.nom} : aucune ligne sur la période, alors que le consolidé en contient pour {fm(v.pa)} DA de part assisteur. Demandez le fichier à la succursale avant de régulariser.
                  </li>
                ))}
              </ul>
            </Notice>
          ) : null}
          {alerts.length ? <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">{alerts.map((t) => <li key={t}>{t}</li>)}</ul> : <p className="text-sm text-muted-foreground">Rien à signaler.</p>}
          {sins.length ? (
            <>
              <h3 className="font-semibold">⚠ Annulations avec sinistre associé ({sins.length})</h3>
              <Card className="overflow-x-auto p-0">
                <table className="w-full min-w-[760px] text-sm">
                  <thead><tr className="bg-muted/50">{["Mois", "Police", "Immatriculation", "Agence", "Produit"].map((h) => <th key={h} className={cn(th, "text-left")}>{h}</th>)}<th className={cn(th, "text-right")}>Prime annulée</th><th className={cn(th, "text-right")}>Part Assisteur annulée</th></tr></thead>
                  <tbody>
                    {sins.map((x, i) => (
                      <tr key={`${x.police}-${i}`} className="border-t">
                        <td className="px-2 py-1">{REGUL_MOIS[x.m - 1]}</td><td className="px-2 py-1">{x.police}</td><td className="px-2 py-1">{x.immat}</td><td className="px-2 py-1">{x.agence}</td><td className="px-2 py-1">{x.produit}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{fm(x.prime)}</td><td className="px-2 py-1 text-right tabular-nums">{fm(x.pa)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            </>
          ) : null}
          <details className="rounded-lg border bg-card">
            <summary className="cursor-pointer px-3 py-2 font-semibold">Contrôle agence par agence (Part Assisteur : consolidé / fichiers / écart)</summary>
            <div className="overflow-x-auto p-3">
              <table className="w-full min-w-[700px] text-sm">
                <thead>
                  <tr className="bg-muted/50">
                    <th className={cn(th, "text-left")}>Agence</th>
                    {A.months.map((m) => ["consolidé", "fichier", "écart"].map((h) => <th key={`${m}${h}`} className={cn(th, "text-right")}>{(REGUL_MOIS[m - 1] ?? "").slice(0, 4)}. {h}</th>))}
                  </tr>
                </thead>
                <tbody>
                  {A.agTab.map((a) => (
                    <tr key={a.code} className="border-t">
                      <td className="px-2 py-1">{a.code} {a.nom.replace(/^\d+-/, "")}</td>
                      {a.par.map((p) => {
                        const e = Math.round((p.f.pa - p.b.pa) * 100) / 100;
                        return [
                          <td key={`${p.m}b`} className="px-2 py-1 text-right tabular-nums">{fm(p.b.pa)}</td>,
                          <td key={`${p.m}f`} className="px-2 py-1 text-right tabular-nums">{fm(p.f.pa)}</td>,
                          <td key={`${p.m}e`} className={cn("px-2 py-1 text-right tabular-nums", e < 0 && "text-destructive", e > 0 && "text-success")}>{e ? fm(e) : "—"}</td>,
                        ];
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          <div className="flex flex-wrap items-center gap-2">
            {canExport ? <Button type="button" onClick={exportXlsx}>Exporter le classeur Excel</Button> : null}
            {canEdit ? <Button type="button" variant="outline" disabled={pending} onClick={save}>Enregistrer ce résultat dans le suivi</Button> : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
