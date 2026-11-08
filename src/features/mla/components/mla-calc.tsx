"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import { mlaEstablishAction, mlaPrepareAction, mlaSaveParamsAction, mlaStoreFilesAction } from "@/app/actions/mla-actions";
import { Notice } from "@/components/common/notice";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { computeMla, mlaInvoiceRows, monthLabel, paramsForYear, parseActivities, parseFleet, type ActivityFile, type FleetFile, type MlaParamsByYear } from "@/features/mla/services/mla-engine";
import { readWorkbook } from "@/lib/spreadsheet";
import { formatDA, formatDate } from "@/utils/format";

/** Onglet « Facture MLA » : flotte du mois + activité → mensualité et retraits sinistrés → facture au modèle MLA. */
export function MlaCalc({ canEdit, isAdmin, paramsByYear }: Readonly<{ canEdit: boolean; isAdmin: boolean; paramsByYear: MlaParamsByYear }>): React.JSX.Element {
  const router = useRouter();
  const fleetInput = useRef<HTMLInputElement>(null);
  const actInput = useRef<HTMLInputElement>(null);
  const [fleet, setFleet] = useState<FleetFile | null>(null);
  const [fleetName, setFleetName] = useState("");
  const [activity, setActivity] = useState<ActivityFile | null>(null);
  const [actName, setActName] = useState("");
  const [monthSel, setMonthSel] = useState("");
  const [fleetFile, setFleetFile] = useState<File | null>(null);
  const [actFile, setActFile] = useState<File | null>(null);
  const [paramYear, setParamYear] = useState(2026);
  const [off, setOff] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<{ tone: "error" | "info"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  async function readFile(file: File | undefined, kind: "fleet" | "activity"): Promise<void> {
    if (!file) return;
    setMessage(null);
    try {
      const sheets = readWorkbook(new Uint8Array(await file.arrayBuffer()));
      if (kind === "fleet") {
        const parsed = parseFleet(sheets);
        if (!parsed.months.length) throw new Error("aucun onglet « MM AAAA » trouvé");
        setFleet(parsed);
        setFleetName(file.name);
        setFleetFile(file);
        setOff(new Set());
        if (monthSel && !parsed.months.some((entry) => `${entry.year}-${String(entry.month).padStart(2, "0")}` === monthSel)) {
          setMessage({ tone: "error", text: `Le classeur « ${file.name} » n'a pas d'onglet pour ce mois (onglets trouvés : ${parsed.months.map((entry) => entry.sheet).join(", ")}).` });
        }
      } else {
        const parsed = parseActivities(sheets);
        if (!parsed.dossiers) throw new Error("colonne « Immatriculation » ou dossiers introuvables");
        setActivity(parsed);
        setActName(file.name);
        setActFile(file);
      }
    } catch (error) {
      setMessage({ tone: "error", text: `« ${file.name} » : ${error instanceof Error ? error.message : "fichier illisible"}` });
    }
  }

  const sheet = fleet && monthSel ? (fleet.months.find((entry) => `${entry.year}-${String(entry.month).padStart(2, "0")}` === monthSel)?.sheet ?? "") : "";
  const result = useMemo(() => (fleet && sheet ? computeMla(fleet, sheet, activity, paramsForYear(paramsByYear, Number(monthSel.slice(0, 4)) || 2026)) : null), [fleet, sheet, activity, paramsByYear]);
  const formParams = paramsForYear(paramsByYear, paramYear);
  const retained = result ? result.retraits.filter((line) => line.sinistre && !off.has(line.key)) : [];
  const ht = result ? result.mensualite + retained.length * result.prixRetrait : 0;

  function toggle(key: string): void {
    setOff((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  /** Garde la flotte et les activités du mois dans la fiche MLA avant d'établir la facture. */
  async function keepFiles(per: string): Promise<string | null> {
    const body = new FormData();
    body.set("month", per);
    if (fleetFile) body.set("fleet", fleetFile);
    if (actFile) body.set("activity", actFile);
    const stored = await mlaStoreFilesAction(body);
    // Une panne de base (table pas encore créée, par exemple) ne bloque pas la facture ; une erreur de fichier (taille, format) la bloque.
    return stored.success || stored.code === "DATABASE" ? null : stored.error;
  }

  /** Conserve les fichiers du mois choisi sans établir de facture (facture déjà faite, par exemple). */
  function keepOnly(): void {
    if (!monthSel || (!fleetFile && !actFile)) return;
    startTransition(async () => {
      const body = new FormData();
      body.set("month", monthSel);
      if (fleetFile) body.set("fleet", fleetFile);
      if (actFile) body.set("activity", actFile);
      const stored = await mlaStoreFilesAction(body);
      if (!stored.success) return setMessage({ tone: "error", text: stored.error });
      setMessage({ tone: "info", text: stored.data.saved ? "Fichiers conservés dans la fiche MLA pour ce mois." : "Ces fichiers sont déjà conservés pour ce mois." });
      router.refresh();
    });
  }

  function establishNow(): void {
    if (!result) return;
    const per = `${result.year}-${String(result.month).padStart(2, "0")}`;
    startTransition(async () => {
      const keepError = await keepFiles(per);
      if (keepError) return setMessage({ tone: "error", text: keepError });
      const done = await mlaEstablishAction({ rows: mlaInvoiceRows(result, retained.map((line) => line.key)), per, perTxt: monthLabel(result.year, result.month), notes: "" });
      if (!done.success) return setMessage({ tone: "error", text: done.error });
      router.push(`/facturation/${done.data.id}`);
    });
  }

  function openEditor(): void {
    if (!result) return;
    const per = `${result.year}-${String(result.month).padStart(2, "0")}`;
    startTransition(async () => {
      const keepError = await keepFiles(per);
      if (keepError) return setMessage({ tone: "error", text: keepError });
      const saved = await mlaPrepareAction({
        rows: mlaInvoiceRows(result, retained.map((line) => line.key)),
        per,
        perTxt: monthLabel(result.year, result.month),
        notes: "",
      });
      if (!saved.success) return setMessage({ tone: "error", text: saved.error });
      router.push(`/facturation/nouvelle?modele=m_mla&mla=${saved.data.token}`);
    });
  }

  function saveParams(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    startTransition(async () => {
      const saved = await mlaSaveParamsAction({ year: paramYear, primeAnnuelle: Number(String(form.get("annuelle")).replace(",", ".")), primeRetraitMois: Number(String(form.get("retrait")).replace(",", ".")) });
      setMessage(saved.success ? { tone: "info", text: `Primes ${paramYear} enregistrées : elles s'appliquent aux factures de ${paramYear}.` } : { tone: "error", text: saved.error });
      if (saved.success) router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {isAdmin ? (
        <Card className="p-4">
          <form onSubmit={saveParams} className="flex flex-wrap items-end gap-3">
            <div>
              <label htmlFor="mla-year" className="text-sm font-medium">
                Année
              </label>
              <Input id="mla-year" type="number" min={2020} max={2100} value={paramYear} onChange={(event) => setParamYear(Number(event.target.value) || 2026)} className="w-24" required />
            </div>
            <div>
              <label htmlFor="mla-annuelle" className="text-sm font-medium">
                Prime annuelle par véhicule (DA HT)
              </label>
              <Input key={`a${paramYear}${formParams.primeAnnuelle}`} id="mla-annuelle" name="annuelle" inputMode="decimal" defaultValue={String(formParams.primeAnnuelle)} className="w-44" required />
            </div>
            <div>
              <label htmlFor="mla-retrait" className="text-sm font-medium">
                Retrait sinistré, par mois (DA HT)
              </label>
              <Input key={`r${paramYear}${formParams.primeRetraitMois}`} id="mla-retrait" name="retrait" inputMode="decimal" defaultValue={String(formParams.primeRetraitMois)} className="w-44" required />
            </div>
            <Button type="submit" variant="outline" disabled={pending}>
              Enregistrer les primes
            </Button>
            <p className="basis-full text-xs text-muted-foreground">Réservé aux administrateurs. Les primes sont figées par année : 2026 reste à 12 000 / 1 000 DA tant que tu ne les modifies pas. Changer une année ne touche ni les autres années ni les factures déjà établies.</p>
          </form>
        </Card>
      ) : null}
      <Card className="flex flex-col gap-3 p-4">
        <div className="max-w-xs">
          <label htmlFor="mla-month" className="text-sm font-medium">
            1. Mois à traiter
          </label>
          <Input
            id="mla-month"
            type="month"
            value={monthSel}
            onChange={(event) => {
              setMonthSel(event.target.value);
              setOff(new Set());
              setMessage(null);
            }}
          />
          <p className="mt-1 text-xs text-muted-foreground">Choisissez d'abord le mois : l'onglet de la flotte et les retraits de ce mois sont utilisés, et les fichiers sont conservés sous ce mois.</p>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <p className="text-sm font-medium">2. Flotte MLA (classeur avec les onglets par mois et « Retrait »)</p>
            <input ref={fleetInput} type="file" accept=".xlsx,.xlsm,.xls" className="hidden" onChange={(event) => void readFile(event.target.files?.[0], "fleet")} />
            <Button type="button" variant="outline" className="mt-1" disabled={!monthSel} onClick={() => fleetInput.current?.click()}>
              Choisir la flotte
            </Button>
            <p className="mt-1 text-xs text-muted-foreground">{fleet ? `${fleetName} · ${fleet.months.length} mois, ${fleet.retraits.length} véhicules retirés` : "Aucun fichier."}</p>
          </div>
          <div>
            <p className="text-sm font-medium">3. Activités MLA (export des dossiers)</p>
            <input ref={actInput} type="file" accept=".xlsx,.xlsm,.xls" className="hidden" onChange={(event) => void readFile(event.target.files?.[0], "activity")} />
            <Button type="button" variant="outline" className="mt-1" disabled={!monthSel} onClick={() => actInput.current?.click()}>
              Choisir les activités
            </Button>
            <p className="mt-1 text-xs text-muted-foreground">{activity ? `${actName} · ${activity.dossiers} dossiers, ${activity.vehicules} véhicules` : "Aucun fichier."}</p>
          </div>
        </div>
      </Card>

      {canEdit && monthSel && (fleetFile || actFile) ? (
        <div>
          <Button type="button" variant="outline" disabled={pending} onClick={keepOnly}>
            Conserver les fichiers de ce mois sans établir de facture
          </Button>
        </div>
      ) : null}
      {fleet && monthSel && !sheet && !message ? <Notice tone="error">La flotte « {fleetName} » n'a pas d'onglet pour ce mois.</Notice> : null}
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      {result && !activity ? <Notice tone="info">Ajoutez le fichier des activités pour repérer les véhicules retirés qui ont eu des dossiers (sinistrés).</Notice> : null}

      {result ? (
        <>
          <Card className="grid grid-cols-2 gap-3 p-4 md:grid-cols-4">
            <div>
              <p className="text-xs text-muted-foreground">Véhicules ({monthLabel(result.year, result.month)})</p>
              <p className="text-lg font-semibold tabular-nums">{result.vehicules.toLocaleString("fr-FR")}</p>
              <p className="text-xs text-muted-foreground">× {formatDA(result.params.primeAnnuelle)} par an = {formatDA(result.annuel)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Mensualité {String(result.month).padStart(2, "0")}/12</p>
              <p className="text-lg font-semibold tabular-nums">{formatDA(result.mensualite)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Retraits du mois / sinistrés</p>
              <p className="text-lg font-semibold tabular-nums">
                {result.retraits.length} / {result.retraits.filter((line) => line.sinistre).length}
              </p>
              <p className="text-xs text-muted-foreground">
                {formatDA(result.params.primeRetraitMois)} × {result.moisRetrait} mois = {formatDA(result.prixRetrait)} par véhicule
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total HT / TTC (TVA 19 %)</p>
              <p className="text-lg font-semibold tabular-nums">{formatDA(ht)}</p>
              <p className="text-xs text-muted-foreground">{formatDA(Math.round(ht * 119) / 100)} TTC</p>
            </div>
          </Card>

          <Card className="p-0">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
              <p className="text-sm font-medium">
                Véhicules retirés en {monthLabel(result.year, result.month)} : {retained.length} sinistré(s) retenu(s) pour la facture
              </p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" disabled={!canEdit || pending || !activity} onClick={openEditor}>
                  Ouvrir dans l'éditeur
                </Button>
                <Button type="button" disabled={!canEdit || pending || !activity} onClick={establishNow}>
                  {pending ? "Établissement…" : "Établir la facture MLA"}
                </Button>
              </div>
            </div>
            {result.retraits.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead>Immatriculation</TableHead>
                    <TableHead>Véhicule</TableHead>
                    <TableHead>Retrait</TableHead>
                    <TableHead>Dossiers</TableHead>
                    <TableHead className="text-right">Facturé HT</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.retraits.map((line) => {
                    const billed = line.sinistre && !off.has(line.key);
                    return (
                      <TableRow key={line.key}>
                        <TableCell>
                          {line.sinistre ? <input type="checkbox" className="size-4 accent-primary" checked={!off.has(line.key)} onChange={() => toggle(line.key)} aria-label={`Facturer ${line.immat}`} /> : null}
                        </TableCell>
                        <TableCell className="whitespace-nowrap font-mono text-xs">{line.immat}</TableCell>
                        <TableCell className="text-xs">{line.modele}</TableCell>
                        <TableCell className="whitespace-nowrap text-xs">{formatDate(line.date)}</TableCell>
                        <TableCell className="text-xs">
                          {line.sinistre ? (
                            <>
                              <Badge variant="warning">{line.dossiers.length} dossier(s)</Badge>
                              <span className="ml-1 text-muted-foreground">{line.dossiers.slice(0, 3).map((dossier) => dossier.num).join(", ")}</span>
                            </>
                          ) : (
                            <span className="text-muted-foreground">{activity ? "aucun dossier : non facturé" : "—"}</span>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right tabular-nums">{billed ? formatDA(result.prixRetrait) : "—"}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            ) : (
              <p className="p-4 text-sm text-muted-foreground">Aucun véhicule retiré ce mois-ci dans l'onglet « Retrait ».</p>
            )}
          </Card>
        </>
      ) : null}
    </div>
  );
}
