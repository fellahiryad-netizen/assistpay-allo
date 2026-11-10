"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { caarRegulWorkDataAction, saveCaarAvanceAction, saveCaarResultsAction } from "@/app/actions/caar-regul-actions";
import { Notice } from "@/components/common/notice";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  analyse,
  buildCaarMail,
  CAAR_DEBUT,
  CAAR_LABELS,
  CAAR_SUCCURSALES,
  CAAR_TRIMESTRES,
  calc,
  caarSucc,
  exportName,
  monthsOfTrimestre,
  parseProdFile,
  periodeText,
  SITUATIONS,
  topAgences,
  trimestreOf,
  ym,
  ymLabel,
  ymShort,
  type CaarAvanceSuivi,
  type CaarBaseRow,
  type CaarRegulIndex,
  type CaarSaisie,
  type CaarSucc,
  type ProdLot,
  type Trimestre,
} from "@/features/caar-regul/services/caar-regul-engine";
import { writeCaarRegulWorkbook } from "@/features/caar-regul/services/caar-regul-export";
import { dateFr, downloadBytes, f0, fm, parseAmount } from "@/features/regul/components/regul-format";
import { zipBuffer, zipList } from "@/features/regul/lib/zip-reader";
import { REGUL_MOIS } from "@/features/regul/services/regul-engine";
import { readCsvRows, readWorkbook } from "@/lib/spreadsheet";
import { cn } from "@/utils/cn";

interface Props {
  index: CaarRegulIndex | null;
  sinMeta: { jusqua: string; maj: string; dossiers: number; cles: number } | null;
  canEdit: boolean;
  canExport: boolean;
  initialSucc: CaarSucc | "";
  initialYear: number;
  signataire: string;
  onSaved: () => void;
}

type Msg = { tone: "info" | "error" | "success" | "warning"; text: string } | null;

const ZIP_OK = /\.(csv|txt|xlsx|xls|xlsm|xltx|xltm)$/i;
const MOIS_2026 = [5, 6, 7, 8, 9, 10, 11, 12].map((m) => ym(2026, m));
const YEARS = [2026, 2027, 2028, 2029];
/** Libellé de la succursale dans la Facturation (liste des succursales CAAR). */
const BRANCHE_FACTURE: Readonly<Record<CaarSucc, string>> = { CHERAGA: "Chéraga (Alger)", BOUZAREAH: "Bouzaréah (Alger)", CONSTANTINE: "Constantine", ANNABA: "Annaba", ORAN: "Oran" };

/** Onglet « Régulariser » : succursale, période (mois de 2026 depuis mai, trimestres à partir de 2027), fichiers, calcul, écarts, export et mail. */
export function CaarRegulCalc({ index, sinMeta, canEdit, canExport, initialSucc, initialYear, signataire, onSaved }: Readonly<Props>): React.JSX.Element {
  const input = useRef<HTMLInputElement>(null);
  const [succ, setSucc] = useState<CaarSucc | "">(initialSucc);
  const [year, setYear] = useState(initialYear);
  const [tri, setTri] = useState<Trimestre>("T1");
  const [months2026, setMonths2026] = useState<number[]>([]);
  const [lots, setLots] = useState<ProdLot[]>([]);
  const [base, setBase] = useState<CaarBaseRow[]>([]);
  const [sinKeys, setSinKeys] = useState<string[] | null>(null);
  const [saisies, setSaisies] = useState<Record<string, CaarSaisie>>({});
  const [suivi, setSuivi] = useState<Record<string, CaarAvanceSuivi>>({});
  const [loadedFor, setLoadedFor] = useState("");
  const [msg, setMsg] = useState<Msg>(null);
  const [over, setOver] = useState(false);
  const [pending, startTransition] = useTransition();

  const months = useMemo(() => (year >= 2027 ? monthsOfTrimestre(year, tri) : [...months2026].sort((a, b) => a - b)), [year, tri, months2026]);
  const loadKey = `${succ}|${months.join(",")}`;
  const sinSet = useMemo(() => (sinKeys ? new Set(sinKeys) : null), [sinKeys]);

  const load = useCallback(async (s: CaarSucc, ms: number[], k: string): Promise<void> => {
    const res = await caarRegulWorkDataAction({ succursale: s, months: ms });
    if (!res.success) {
      setMsg({ tone: "error", text: res.error });
      return;
    }
    setBase(res.data.base);
    setSinKeys(res.data.sinKeys);
    setSaisies(res.data.saisies);
    setSuivi(res.data.suivi);
    setLoadedFor(k);
  }, []);

  useEffect(() => {
    if (succ && months.length && loadedFor !== loadKey) void load(succ, months, loadKey);
  }, [succ, months, loadKey, loadedFor, load]);

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
    const next = [...lots];
    for (const f of expanded) {
      try {
        const bytes = new Uint8Array(await f.arrayBuffer());
        const sheets = /\.(csv|txt)$/i.test(f.name) ? [{ name: f.name, rows: readCsvRows(bytes) }] : readWorkbook(bytes);
        const parsed = parseProdFile(f.name, f.size, sheets);
        if (!parsed.length) throw new Error("aucune feuille avec les colonnes POLICE et PRIME");
        for (const part of parsed) {
          const at = next.findIndex((x) => x.id === part.id);
          if (at >= 0) next.splice(at, 1);
          next.push(part);
        }
        if (!succ) {
          const s = caarSucc(f.name);
          if (s) setSucc(s);
        }
      } catch (error) {
        setMsg({ tone: "error", text: `« ${f.name} » : ${error instanceof Error ? error.message : "fichier illisible"}` });
      }
    }
    setLots(next);
    syncPeriod(next);
  }

  function syncPeriod(list: ProdLot[]): void {
    const yms = list.filter((l) => !l.ignore && l.ym).map((l) => l.ym).sort((a, b) => a - b);
    const first = yms[0];
    if (!first) return;
    const y = Math.floor(first / 100);
    if (y >= 2027) {
      setYear(y);
      setTri(trimestreOf(first));
    } else {
      setYear(2026);
      setMonths2026([...new Set(yms.filter((v) => Math.floor(v / 100) === 2026 && v >= CAAR_DEBUT))]);
    }
  }

  function setLotMonth(i: number, v: number): void {
    const next = lots.map((x, j) => (j === i ? { ...x, ym: v, ignore: !v, avant: false } : x));
    setLots(next);
    if (year < 2027 && v && !months2026.includes(v)) setMonths2026([...months2026, v]);
  }

  const ready = Boolean(succ) && months.length > 0 && lots.some((l) => !l.ignore && months.includes(l.ym));
  const loaded = loadedFor === loadKey;
  const A = useMemo(() => (ready && loaded && succ ? analyse(succ, months, lots, base, index?.forms ?? [], sinSet) : null), [ready, loaded, succ, months, lots, base, index, sinSet]);
  const C = useMemo(() => (A ? calc(A, index, saisies, suivi) : null), [A, index, saisies, suivi]);
  const mail = useMemo(() => (A && C ? buildCaarMail(A, C, signataire) : null), [A, C, signataire]);
  const [mailSubject, setMailSubject] = useState("");
  const [mailText, setMailText] = useState("");
  useEffect(() => {
    setMailSubject(mail?.subject ?? "");
    setMailText(mail?.body ?? "");
  }, [mail]);

  function editAvance(key: string, raw: string): void {
    if (!canEdit || !succ) {
      setMsg({ tone: "warning", text: "Vous avez un accès en consultation uniquement." });
      return;
    }
    const value = parseAmount(raw);
    setSaisies((s) => ({ ...s, [key]: { succ, avance: value } }));
    startTransition(async () => {
      const res = await saveCaarAvanceAction({ key, succursale: succ, avance: value });
      if (!res.success) setMsg({ tone: "error", text: res.error });
    });
  }

  function exportXlsx(): void {
    if (!A) return;
    try {
      downloadBytes(exportName(A), writeCaarRegulWorkbook(A, index, saisies, sinMeta && sinKeys ? sinMeta.jusqua : null, suivi));
    } catch {
      setMsg({ tone: "error", text: "Le fichier n'a pas pu être créé." });
    }
  }

  /** Lien vers la Facturation avec la facture « Régularisation 10 % CAAR » préremplie (succursale, période, une ligne par mois). */
  function invoiceHref(): string | null {
    if (!A || !C || !C.rows.length || !C.rows.every((r) => r.hasFile) || !(C.tot.pa > 0)) return null;
    const last = C.rows[C.rows.length - 1]?.ym ?? 0;
    const lignes = C.rows.map((r) => `${ymShort(r.ym)}:${r.total}:${r.avance}:${r.regule}`).join(";");
    const query = new URLSearchParams({ modele: "r_regul", succ: BRANCHE_FACTURE[A.s], per: `${Math.floor(last / 100)}-${String(last % 100).padStart(2, "0")}`, perTxt: periodeText(A.months), lignes });
    return `/facturation/nouvelle?${query.toString()}`;
  }

  function save(): void {
    if (!A || !C) return;
    const results = C.rows
      .filter((r) => r.hasFile)
      .map((r) => ({ key: r.key, succ: A.s, ym: r.ym, annee: Math.floor(r.ym / 100), mois: r.ym % 100, total: r.total, avance: r.avance, regule: r.regule, ecart: r.ecart, tva: r.tva, pa: r.pa, fact: r.fact, top: topAgences(A, r.ym), fichiers: A.lots.filter((l) => l.ym === r.ym).map((l) => `${l.name} (${l.sheet})`), maj: "" }));
    startTransition(async () => {
      const res = await saveCaarResultsAction({ resume: `${CAAR_LABELS[A.s]} ${ymLabel(A.months[0] ?? 0)}… : écart HT ${fm(C.tot.ecart)} DA, TTC ${fm(C.tot.pa)} DA`, results });
      if (!res.success) setMsg({ tone: "error", text: res.error });
      else {
        setMsg({ tone: "success", text: "Résultat enregistré dans le suivi." });
        onSaved();
      }
    });
  }

  const th = "px-2 py-1.5 text-xs font-semibold";
  const alerts: string[] = [];
  if (A && C) {
    if (!A.baseN) alerts.push("Consolidé non chargé : l'écart HT et la facture sont justes (avance prise dans le suivi), mais le détail police par police et par agence n'est pas disponible. Déposez le consolidé dans « Bases de données » pour l'avoir.");
    if (A.liste.length) alerts.push(`${A.liste.length} police(s) reprise(s) de la liste « polices exclues » placée sous le total du fichier : comptées et classées « réintégrées ».`);
    if (A.nonEnc.length) alerts.push(`${A.nonEnc.length} quittance(s) non encaissée(s) laissée(s) de côté (${fm(A.nonEnc.reduce((a, x) => a + x.prime, 0))} DA de prime).`);
    if (A.garan.length) alerts.push(`${A.garan.length} ligne(s) négative(s) correspondant à un changement de formule (pas une vraie annulation).`);
    if (!sinKeys) alerts.push("Base activité non chargée : les annulations ne sont pas croisées avec les sinistres.");
    for (const r of C.rows) {
      if (r.sansFacture) alerts.push(`${ymLabel(r.ym)} : aucune facture d'avance trouvée dans les factures partenaires ni dans RECAP FACTURES${r.avance > 0 ? ", l'avance est calculée sur la Part Assisteur 90 % du consolidé." : " : saisissez l'avance HT à la main."}`);
      if (r.src === "suivi" && r.regle === false) alerts.push(`${ymLabel(r.ym)} : la facture d'avance ${r.fact} n'est pas encore marquée réglée dans le suivi.`);
      if (r.multi) alerts.push(`${ymLabel(r.ym)} : plusieurs factures d'avance trouvées pour ce mois (${r.fact}), additionnées : vérifiez.`);
      if (r.ecartConso) alerts.push(`${ymLabel(r.ym)} : l'avance du suivi diffère de RECAP FACTURES de ${fm(r.ecartConso)} DA TTC ; c'est le suivi (paiement vérifié) qui est retenu.`);
    }
  }
  const anomalies = A ? A.months.flatMap((v) => (A.agTab[v] ?? []).filter((o) => o.statut === "ANOMALIE").map((o) => ({ ...o, ym: v }))) : [];
  const sins = A ? A.annul.filter((x) => x.sinistre) : [];
  const tf = A ? A.tunisie.filter((t) => t.ou === "fichier") : [];
  const ta = A ? A.tunisie.filter((t) => t.ou === "avance") : [];

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-4">
        <h3 className="mb-1 font-semibold">Régulariser une succursale</h3>
        <p className="mb-3 text-sm text-muted-foreground">Choisissez la succursale, puis déposez les fichiers de production qu&apos;elle a renvoyés (un ou plusieurs mois, Excel ou zip). Le mois est lu dans le nom de l&apos;onglet, sinon dans le nom du fichier, sinon dans les dates d&apos;effet.</p>
        <div className="grid max-w-3xl gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1 text-sm">
            Succursale
            <NativeSelect value={succ} onChange={(e) => setSucc((CAAR_SUCCURSALES as readonly string[]).includes(e.target.value) ? (e.target.value as CaarSucc) : "")}>
              <option value="">— choisir —</option>
              {CAAR_SUCCURSALES.map((s) => <option key={s} value={s}>{CAAR_LABELS[s]}</option>)}
            </NativeSelect>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Année
            <NativeSelect value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {YEARS.map((y) => <option key={y} value={y}>{y}{y === 2026 ? " (depuis mai)" : " (par trimestre)"}</option>)}
            </NativeSelect>
          </label>
          {year >= 2027 ? (
            <label className="flex flex-col gap-1 text-sm">
              Trimestre
              <NativeSelect value={tri} onChange={(e) => setTri(e.target.value as Trimestre)}>
                {(Object.keys(CAAR_TRIMESTRES) as Trimestre[]).map((t) => (
                  <option key={t} value={t}>Trimestre {t.slice(1)} ({CAAR_TRIMESTRES[t].map((m) => (REGUL_MOIS[m - 1] ?? "").toLowerCase()).join(", ")})</option>
                ))}
              </NativeSelect>
            </label>
          ) : null}
        </div>
        {year < 2027 ? (
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {MOIS_2026.map((v) => {
              const has = lots.some((l) => l.ym === v && !l.ignore);
              return (
                <label key={v} className={cn("inline-flex items-center gap-1 whitespace-nowrap", !has && "opacity-60")}>
                  <input type="checkbox" checked={months2026.includes(v)} onChange={(e) => setMonths2026((m) => (e.target.checked ? [...new Set([...m, v])] : m.filter((x) => x !== v)))} />
                  {ymShort(v)}
                </label>
              );
            })}
            <span className="basis-full text-xs text-muted-foreground">2026 : le partenariat a commencé en mai ; les mois se cochent seuls selon les fichiers déposés.</span>
          </div>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">À partir de 2027, la régularisation se fait trimestre par trimestre.</p>
        )}
        <input ref={input} type="file" multiple accept=".csv,.txt,.xlsx,.xls,.xlsm,.xltx,.xltm,.zip" className="hidden" onChange={(e) => { if (e.target.files) void addFiles(e.target.files); e.target.value = ""; }} />
        <button
          type="button"
          onClick={() => input.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); void addFiles(e.dataTransfer.files); }}
          className={cn("mt-4 w-full rounded-lg border-2 border-dashed p-6 text-center", over && "border-primary")}
        >
          <b>Déposez ici les fichiers de production renvoyés par la succursale</b>
          <span className="block text-xs text-muted-foreground">Excel (un onglet par mois accepté) ou zip ; la liste « polices exclues » placée sous le total est reprise automatiquement</span>
        </button>
        {lots.length ? (
          <div className="mt-3 flex flex-col gap-2 text-sm">
            {lots.map((l, i) => (
              <div key={l.id} className="flex flex-wrap items-center gap-3">
                <b>{l.name}</b>
                <span className="text-xs text-muted-foreground">onglet « {l.sheet} »</span>
                <span>{f0(l.lignes.length)} lignes{l.liste.length ? ` + ${l.liste.length} en liste d'exclusion` : ""} · prime {fm(l.lignes.reduce((a, x) => a + x.prime, 0))} DA</span>
                <label className="flex items-center gap-1">
                  Mois
                  <NativeSelect className="h-8 w-44" value={l.ignore ? 0 : l.ym} onChange={(e) => setLotMonth(i, Number(e.target.value))}>
                    <option value={0}>— ignorer —</option>
                    {(year >= 2027 ? Array.from({ length: 12 }, (_, k) => ym(year, k + 1)) : MOIS_2026).map((v) => <option key={v} value={v}>{ymLabel(v)}</option>)}
                    {l.ym && !l.ignore && (year >= 2027 ? Math.floor(l.ym / 100) !== year : l.ym < CAAR_DEBUT || Math.floor(l.ym / 100) !== 2026) ? <option value={l.ym}>{ymLabel(l.ym)}</option> : null}
                  </NativeSelect>
                </label>
                {l.avant ? <span className="rounded-full bg-warning/20 px-2 py-0.5 text-xs">avant mai 2026 : hors partenariat, ignoré</span> : l.ignore ? <span className="rounded-full bg-warning/20 px-2 py-0.5 text-xs">onglet sans mois : ignoré</span> : months.includes(l.ym) ? null : <span className="rounded-full bg-warning/20 px-2 py-0.5 text-xs">hors période</span>}
                <Button type="button" size="sm" variant="outline" onClick={() => setLots((list) => list.filter((_, j) => j !== i))}>Retirer</Button>
              </div>
            ))}
          </div>
        ) : null}
      </Card>
      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
      {!succ ? <p className="text-sm text-muted-foreground">Choisissez la succursale pour lancer le contrôle.</p> : !ready ? <p className="text-sm text-muted-foreground">Déposez au moins un fichier de production et cochez son mois pour lancer le calcul.</p> : !loaded ? <p className="text-sm text-muted-foreground">Analyse en cours…</p> : null}
      {A && C ? (
        <>
          <div className="grid gap-2 sm:grid-cols-5">
            {[
              ["Lignes lues", f0(A.L.length), `${f0(A.C.length)} comptées`],
              ["Polices en écart", f0(A.ecarts.filter((e) => e.sit !== "N° de police corrigé").length), ""],
              ["Annulations", f0(A.annul.length), sinKeys ? `${sins.length} avec sinistre` : "base activité non chargée"],
              ["Écart HT", fm(C.tot.ecart), ""],
              ["À facturer TTC", fm(C.tot.pa), ""],
            ].map(([k, v, h]) => (
              <div key={k} className="rounded-lg border bg-card p-3">
                <span className="block text-xs text-muted-foreground">{k}</span>
                <span className="block text-lg font-semibold tabular-nums">{v}</span>
                {h ? <span className="block text-xs text-muted-foreground">{h}</span> : null}
              </div>
            ))}
          </div>
          <h3 className="font-semibold">Régularisation 10 % (HT + TVA 19 % sur l&apos;écart)</h3>
          <Card className="overflow-x-auto p-0">
            <table className="w-full min-w-[880px] text-sm">
              <thead>
                <tr className="bg-muted/50">
                  <th className={cn(th, "text-left")}>Mois</th>
                  {[["Montant Total", "production de l'avance"], ["Somme Avance", "90 % HT"], ["Montant Régule", "fichier succursale"], ["ECARTS HT", ""], ["TVA 19 %", ""], ["Part Assisteur TTC", ""]].map(([h, s]) => (
                    <th key={h} className={cn(th, "text-right")}>{h}{s ? <span className="block font-normal text-muted-foreground">{s}</span> : null}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {C.rows.map((r) => (
                  <tr key={r.ym} className="border-t">
                    <td className="px-2 py-1.5">
                      <b>{ymLabel(r.ym)}</b>
                      {r.fact ? <span className="block text-xs text-muted-foreground">avance {r.fact} · {fm(r.ttc ?? 0)} TTC</span> : <span className="block text-xs text-destructive">pas de facture d&apos;avance dans le suivi ni au consolidé</span>}
                      {r.src === "suivi" ? (r.regle ? <span className="block text-xs text-success">✔ réglée{r.dateRegl ? ` le ${dateFr(r.dateRegl)}` : ""} (suivi des paiements)</span> : <span className="block text-xs text-destructive">⚠ pas encore réglée dans le suivi</span>) : r.src === "consolide" ? <span className="block text-xs text-muted-foreground">source : consolidé (RECAP FACTURES)</span> : null}
                      {r.totEst ? <span className="block text-xs text-muted-foreground">Montant Total = avance ÷ 0,90 (consolidé non chargé)</span> : null}
                      {r.hasFile ? null : <span className="block text-xs text-destructive">fichier manquant</span>}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{fm(r.total)}</td>
                    <td className="px-1 py-1 text-right">
                      <Input key={`${r.key}-${r.avance}`} className="h-8 w-36 text-right" inputMode="decimal" defaultValue={fm(r.avance)} title={r.edited ? "modifiée à la main" : undefined} onBlur={(e) => { if (parseAmount(e.target.value) !== r.avance) editAvance(r.key, e.target.value); }} />
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{fm(r.regule)}</td>
                    <td className={cn("px-2 py-1.5 text-right tabular-nums", r.ecart < 0 && "text-destructive")}>{fm(r.ecart)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{fm(r.tva)}</td>
                    <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{fm(r.pa)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 bg-muted/50 font-semibold">
                  <td className="px-2 py-2">TOTAL</td>
                  {[C.tot.total, C.tot.avance, C.tot.regule, C.tot.ecart, C.tot.tva, C.tot.pa].map((v, i) => <td key={i} className="px-2 py-2 text-right tabular-nums">{fm(v)}</td>)}
                </tr>
              </tbody>
            </table>
          </Card>
          <p className="text-xs text-muted-foreground">Somme Avance = montant TTC de la facture d&apos;avance ÷ 1,19 (facture prise dans les factures partenaires, paiement vérifié ; à défaut dans RECAP FACTURES du consolidé) ; vous pouvez la corriger (virement confirmé par la banque). Écart = Montant Régule − Somme Avance, dont complément 10 % {fm(C.tot.complement)} et écart de production {fm(C.tot.prod)}.</p>
          <h3 className="font-semibold">Écarts police par police</h3>
          <Card className="overflow-x-auto p-0">
            <table className="w-full min-w-[700px] text-sm">
              <thead>
                <tr className="bg-muted/50">
                  <th className={cn(th, "text-left")}>Situation</th>
                  {A.months.map((v) => <th key={v} className={cn(th, "text-right")}>{ymShort(v)}</th>)}
                  <th className={cn(th, "text-right")}>Total</th>
                </tr>
              </thead>
              <tbody>
                {SITUATIONS.map((sit) => {
                  const per = A.months.map((v) => A.ecarts.filter((e) => e.ym === v && e.sit === sit));
                  const t = per.flat().reduce((a, e) => a + e.d, 0);
                  return (
                    <tr key={sit} className="border-t">
                      <td className="px-2 py-1.5 font-medium">{sit}</td>
                      {per.map((h, j) => (
                        <td key={A.months[j]} className="px-2 py-1.5 text-right tabular-nums">
                          {h.length ? (
                            <>
                              {h.length} pol.
                              <span className="block text-xs text-muted-foreground">{fm(h.reduce((a, e) => a + e.d, 0))}</span>
                            </>
                          ) : "—"}
                        </td>
                      ))}
                      <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{t ? fm(t) : "—"}</td>
                    </tr>
                  );
                })}
                <tr className="border-t-2 bg-muted/50 font-semibold">
                  <td className="px-2 py-2">Écart de production</td>
                  {A.months.map((v) => <td key={v} className="px-2 py-2 text-right tabular-nums">{fm(A.ecarts.filter((e) => e.ym === v).reduce((a, e) => a + e.d, 0))}</td>)}
                  <td className="px-2 py-2 text-right tabular-nums">{fm(C.tot.prod)}</td>
                </tr>
              </tbody>
            </table>
          </Card>
          <h3 className="font-semibold">Détail par agence <span className="text-sm font-normal text-muted-foreground">{anomalies.length} anomalie(s)</span></h3>
          {anomalies.length ? (
            <Card className="overflow-x-auto p-0">
              <table className="w-full min-w-[820px] text-sm">
                <thead>
                  <tr className="bg-muted/50">
                    {["Mois", "Agence"].map((h) => <th key={h} className={cn(th, "text-left")}>{h}</th>)}
                    {["Lignes avance / fichier", "Avance", "Fichier", "Écart HT"].map((h) => <th key={h} className={cn(th, "text-right")}>{h}</th>)}
                    <th className={cn(th, "text-left")}>Explication</th>
                  </tr>
                </thead>
                <tbody>
                  {anomalies.map((o) => (
                    <tr key={`${o.ym}-${o.a}`} className="border-t">
                      <td className="px-2 py-1">{ymShort(o.ym)}</td>
                      <td className="px-2 py-1 font-semibold">{o.a}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{o.nB} / {o.nF}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{fm(o.aB)}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{fm(o.aF)}</td>
                      <td className={cn("px-2 py-1 text-right font-semibold tabular-nums", o.d < 0 ? "text-destructive" : "text-success")}>{fm(o.d)}</td>
                      <td className="px-2 py-1 text-xs text-muted-foreground">{o.expl}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          ) : (
            <p className="text-sm text-muted-foreground">Toutes les agences sont conformes.</p>
          )}
          {Object.keys(A.agMap).length ? <p className="text-xs text-muted-foreground">Codes agence du consolidé alignés sur ceux de la succursale : {Object.entries(A.agMap).map(([x, y]) => `${x} → ${y}`).join(", ")}.</p> : null}
          {A.tunisie.length ? (
            <Notice tone="error">
              <p className="font-semibold">⚠ Formule Assistance TUNISIE avec un montant : {A.tunisie.length} police(s). Elle doit être à 0 DA : ramenée à 0 dans le calcul.</p>
              {tf.length ? <p>Dans le fichier de la succursale : {tf.length} police(s) · {fm(tf.reduce((a, t) => a + t.montant, 0))} DA de prime.</p> : null}
              {ta.length ? <p>Facturées dans l&apos;avance : {ta.length} police(s) · {fm(ta.reduce((a, t) => a + t.montant, 0))} DA de part ALLO, retirés de la régule.</p> : null}
              <p className="text-xs">Le détail est dans l&apos;onglet « ALERTE Tunisie » du classeur exporté.</p>
            </Notice>
          ) : null}
          <h3 className="font-semibold">Points à contrôler</h3>
          {alerts.length ? <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">{alerts.map((t) => <li key={t}>{t}</li>)}</ul> : <p className="text-sm text-muted-foreground">Rien à signaler.</p>}
          {sins.length ? (
            <>
              <h3 className="font-semibold">⚠ Annulations avec sinistre associé ({sins.length})</h3>
              <Card className="overflow-x-auto p-0">
                <table className="w-full min-w-[700px] text-sm">
                  <thead><tr className="bg-muted/50">{["Mois", "Police", "Immatriculation", "Agence", "Assuré"].map((h) => <th key={h} className={cn(th, "text-left")}>{h}</th>)}<th className={cn(th, "text-right")}>Prime annulée</th></tr></thead>
                  <tbody>
                    {sins.map((x, i) => (
                      <tr key={`${x.police}-${i}`} className="border-t">
                        <td className="px-2 py-1">{ymShort(x.ym)}</td><td className="px-2 py-1">{x.police}</td><td className="px-2 py-1">{x.immat}</td><td className="px-2 py-1">{x.agence}</td><td className="px-2 py-1">{x.assure}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{fm(x.prime)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            </>
          ) : null}
          {mail ? (
            <Card className="flex flex-col gap-2 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold">Mail d&apos;accompagnement</h3>
                <span className="text-xs text-muted-foreground">pièce jointe : {exportName(A)}</span>
              </div>
              <label className="flex flex-col gap-1 text-sm">
                Objet
                <Input value={mailSubject} onChange={(e) => setMailSubject(e.target.value)} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Message
                <textarea className="min-h-72 w-full rounded-md border bg-background p-3 text-sm" value={mailText} onChange={(e) => setMailText(e.target.value)} />
              </label>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={() => { void navigator.clipboard.writeText(`Objet : ${mailSubject}\n\n${mailText}`).then(() => setMsg({ tone: "success", text: "Mail copié." })); }}>Copier l&apos;objet et le message</Button>
                <a className="inline-flex h-9 items-center rounded-md border px-4 text-sm font-medium hover:bg-muted" href={`mailto:?subject=${encodeURIComponent(mailSubject)}&body=${encodeURIComponent(mailText)}`}>Ouvrir dans ma messagerie</a>
              </div>
            </Card>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            {canExport ? <Button type="button" onClick={exportXlsx}>Exporter le classeur Excel</Button> : null}
            {canEdit ? <Button type="button" variant="outline" disabled={pending} onClick={save}>Enregistrer ce résultat dans le suivi</Button> : null}
            {invoiceHref() ? (
              <Link href={invoiceHref() ?? "#"} className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">
                Créer la facture (factures partenaires en attente)
              </Link>
            ) : C.tot.pa > 0 ? (
              <span className="text-xs text-muted-foreground">La facture se crée quand chaque mois de la période a son fichier.</span>
            ) : (
              <span className="text-xs text-muted-foreground">Écart nul ou négatif : rien à facturer.</span>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
