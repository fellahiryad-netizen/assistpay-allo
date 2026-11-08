"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import { mlaPrepareAction } from "@/app/actions/mla-actions";
import { Notice } from "@/components/common/notice";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { computeMla, MLA_PRIME_ANNUELLE, MLA_PRIME_RETRAIT_MOIS, mlaInvoiceRows, monthLabel, parseActivities, parseFleet, type ActivityFile, type FleetFile } from "@/features/mla/services/mla-engine";
import { readWorkbook } from "@/lib/spreadsheet";
import { formatDA, formatDate } from "@/utils/format";

/** Onglet « Facture MLA » : flotte du mois + activité → mensualité et retraits sinistrés → facture au modèle MLA. */
export function MlaCalc({ canEdit }: Readonly<{ canEdit: boolean }>): React.JSX.Element {
  const router = useRouter();
  const fleetInput = useRef<HTMLInputElement>(null);
  const actInput = useRef<HTMLInputElement>(null);
  const [fleet, setFleet] = useState<FleetFile | null>(null);
  const [fleetName, setFleetName] = useState("");
  const [activity, setActivity] = useState<ActivityFile | null>(null);
  const [actName, setActName] = useState("");
  const [sheet, setSheet] = useState("");
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
        setSheet(parsed.months[parsed.months.length - 1]?.sheet ?? "");
        setOff(new Set());
      } else {
        const parsed = parseActivities(sheets);
        if (!parsed.dossiers) throw new Error("colonne « Immatriculation » ou dossiers introuvables");
        setActivity(parsed);
        setActName(file.name);
      }
    } catch (error) {
      setMessage({ tone: "error", text: `« ${file.name} » : ${error instanceof Error ? error.message : "fichier illisible"}` });
    }
  }

  const result = useMemo(() => (fleet && sheet ? computeMla(fleet, sheet, activity) : null), [fleet, sheet, activity]);
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

  function establish(): void {
    if (!result) return;
    const per = `${result.year}-${String(result.month).padStart(2, "0")}`;
    startTransition(async () => {
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

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-3 p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <p className="text-sm font-medium">1. Flotte MLA (classeur avec les onglets par mois et « Retrait »)</p>
            <input ref={fleetInput} type="file" accept=".xlsx,.xlsm,.xls" className="hidden" onChange={(event) => void readFile(event.target.files?.[0], "fleet")} />
            <Button type="button" variant="outline" className="mt-1" onClick={() => fleetInput.current?.click()}>
              Choisir la flotte
            </Button>
            <p className="mt-1 text-xs text-muted-foreground">{fleet ? `${fleetName} · ${fleet.months.length} mois, ${fleet.retraits.length} véhicules retirés` : "Aucun fichier."}</p>
          </div>
          <div>
            <p className="text-sm font-medium">2. Activités MLA (export des dossiers)</p>
            <input ref={actInput} type="file" accept=".xlsx,.xlsm,.xls" className="hidden" onChange={(event) => void readFile(event.target.files?.[0], "activity")} />
            <Button type="button" variant="outline" className="mt-1" onClick={() => actInput.current?.click()}>
              Choisir les activités
            </Button>
            <p className="mt-1 text-xs text-muted-foreground">{activity ? `${actName} · ${activity.dossiers} dossiers, ${activity.vehicules} véhicules` : "Aucun fichier."}</p>
          </div>
        </div>
        {fleet ? (
          <div className="max-w-xs">
            <label htmlFor="mla-sheet" className="text-sm font-medium">
              3. Mois à facturer (onglet de la flotte)
            </label>
            <NativeSelect id="mla-sheet" value={sheet} onChange={(event) => { setSheet(event.target.value); setOff(new Set()); }}>
              {fleet.months.map((month) => (
                <option key={month.sheet} value={month.sheet}>
                  {monthLabel(month.year, month.month)} ({month.count} véhicules)
                </option>
              ))}
            </NativeSelect>
            <p className="mt-1 text-xs text-muted-foreground">Les retraits sont filtrés sur ce même mois.</p>
          </div>
        ) : null}
      </Card>

      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      {result && !activity ? <Notice tone="info">Ajoutez le fichier des activités pour repérer les véhicules retirés qui ont eu des dossiers (sinistrés).</Notice> : null}

      {result ? (
        <>
          <Card className="grid grid-cols-2 gap-3 p-4 md:grid-cols-4">
            <div>
              <p className="text-xs text-muted-foreground">Véhicules ({monthLabel(result.year, result.month)})</p>
              <p className="text-lg font-semibold tabular-nums">{result.vehicules.toLocaleString("fr-FR")}</p>
              <p className="text-xs text-muted-foreground">× {formatDA(MLA_PRIME_ANNUELLE)} par an = {formatDA(result.annuel)}</p>
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
                {formatDA(MLA_PRIME_RETRAIT_MOIS)} × {result.moisRetrait} mois = {formatDA(result.prixRetrait)} par véhicule
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
              <Button type="button" disabled={!canEdit || pending || !activity} onClick={establish}>
                {pending ? "Préparation…" : "Établir la facture MLA"}
              </Button>
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
