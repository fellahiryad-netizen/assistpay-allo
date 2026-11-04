"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { cn } from "@/utils/cn";
import { formatDA } from "@/utils/format";
import type { AdvanceCell, AdvanceTable } from "@/features/partners/services/advance-table";

type Mode = "billed" | "paid" | "due";
type Selected = { row: string; month: number | "other" } | null;

const MODES: ReadonlyArray<[Mode, string]> = [["billed", "Facturé"], ["paid", "Encaissé"], ["due", "Reste à encaisser"]];
const HEADS = ["Janv", "Févr", "Mars", "Avr", "Mai", "Juin", "Juil", "Août", "Sept", "Oct", "Nov", "Déc"];
const FULL = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const TONE: Record<AdvanceCell["state"], string> = {
  vide: "text-muted-foreground",
  zero: "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200",
  attente: "bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-200",
  partiel: "bg-orange-50 text-orange-800 dark:bg-orange-950/40 dark:text-orange-200",
  regle: "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200",
};
const LEGEND: ReadonlyArray<[AdvanceCell["state"], string]> = [["regle", "Réglé"], ["partiel", "Réglé en partie"], ["attente", "En attente"], ["zero", "Ligne créée, montant à saisir"]];

/** Tableau de paiement dynamique : succursale × mois, trois lectures (facturé, encaissé, reste) et détail au clic. */
export function AdvanceGrid({ table }: Readonly<{ table: AdvanceTable }>): React.JSX.Element {
  const [mode, setMode] = useState<Mode>("billed");
  const [selected, setSelected] = useState<Selected>(null);
  const [only, setOnly] = useState<"" | "attente" | "zero">("");

  const cell = (row: AdvanceTable["rows"][number], month: number | "other"): AdvanceCell => (month === "other" ? row.other : (row.months[month] ?? row.other));
  const shown = (value: AdvanceCell): string => (value.state === "vide" ? "" : formatDA(value[mode]));
  const detail = useMemo(() => {
    if (!selected) return null;
    const row = table.rows.find((r) => r.key === selected.row);
    return row ? { row, cell: cell(row, selected.month) } : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, table]);

  const kpi = table.totals;
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-2 sm:grid-cols-3">
        {MODES.map(([key, label]) => (
          <button key={key} type="button" onClick={() => setMode(key)} className={cn("rounded-lg border bg-card p-3 text-left transition", mode === key && "border-primary ring-1 ring-primary")}>
            <span className="block text-xs text-muted-foreground">{label}</span>
            <span className="block text-lg font-semibold tabular-nums">{formatDA(kpi[key])}</span>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs">
        {LEGEND.map(([state, label]) => (
          <span key={state} className="inline-flex items-center gap-1">
            <span className={cn("inline-block h-3 w-3 rounded border", TONE[state])} /> {label}
          </span>
        ))}
        <span className="ml-auto inline-flex items-center gap-1">
          Afficher :
          <select value={only} onChange={(e) => setOnly(e.target.value as typeof only)} className="rounded border bg-background px-1 py-0.5">
            <option value="">Toutes les lignes</option>
            <option value="attente">Lignes avec un reste à encaisser</option>
            <option value="zero">Lignes sans montant</option>
          </select>
        </span>
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[1100px] border-collapse text-sm">
          <thead>
            <tr className="bg-muted/50 text-xs">
              <th className="sticky left-0 z-10 bg-muted/50 px-2 py-2 text-left">Succursale</th>
              {HEADS.map((head) => (
                <th key={head} className="px-2 py-2 text-right">{head}</th>
              ))}
              <th className="px-2 py-2 text-right">Hors mois</th>
              <th className="px-2 py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {table.rows
              .filter((row) => (only === "attente" ? row.due > 0.005 : only === "zero" ? [...row.months, row.other].some((c) => c.state === "zero") : true))
              .map((row) => (
                <tr key={row.key} className="border-t">
                  <th className="sticky left-0 z-10 bg-background px-2 py-1.5 text-left font-medium">{row.label}</th>
                  {[...Array.from({ length: 12 }, (_, m) => m), "other" as const].map((m) => {
                    const value = cell(row, m);
                    const active = selected?.row === row.key && selected.month === m;
                    return (
                      <td key={m} className="p-0">
                        <button
                          type="button"
                          disabled={value.state === "vide"}
                          onClick={() => setSelected(active ? null : { row: row.key, month: m })}
                          className={cn("block w-full px-2 py-1.5 text-right tabular-nums", TONE[value.state], active && "outline outline-2 outline-primary", value.state !== "vide" && "cursor-pointer hover:brightness-95")}
                        >
                          {shown(value) || "·"}
                          {value.invoices.length > 1 ? <span className="ml-1 text-[10px] opacity-70">×{value.invoices.length}</span> : null}
                        </button>
                      </td>
                    );
                  })}
                  <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{formatDA(row[mode])}</td>
                </tr>
              ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 bg-muted/50 font-semibold">
              <th className="sticky left-0 z-10 bg-muted/50 px-2 py-2 text-left">Total</th>
              {kpi.months.map((value, m) => (
                <td key={m} className="px-2 py-2 text-right tabular-nums">{value[mode] ? formatDA(value[mode]) : "·"}</td>
              ))}
              <td className="px-2 py-2 text-right tabular-nums">{kpi.other[mode] ? formatDA(kpi.other[mode]) : "·"}</td>
              <td className="px-2 py-2 text-right tabular-nums">{formatDA(kpi[mode])}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {detail ? (
        <div className="rounded-lg border bg-card p-3">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">
              {detail.row.label} · {selected?.month === "other" ? "hors avances mensuelles" : FULL[selected?.month ?? 0]} {table.year}
            </h3>
            <button type="button" className="text-xs text-muted-foreground underline" onClick={() => setSelected(null)}>
              Fermer
            </button>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="py-1">Facture</th>
                <th>Libellé</th>
                <th className="text-right">Montant</th>
                <th className="text-right">Encaissé</th>
                <th className="text-right">Reste</th>
                <th>Date règlement</th>
              </tr>
            </thead>
            <tbody>
              {detail.cell.invoices.map((inv) => (
                <tr key={inv.id} className="border-t">
                  <td className="py-1">
                    <Link href={`/factures/${inv.id}`} className="text-primary underline">
                      {inv.numero || "—"}
                    </Link>
                  </td>
                  <td className="max-w-md truncate pr-2" title={inv.libelle}>{inv.libelle}</td>
                  <td className="text-right tabular-nums">{formatDA(inv.montant)}</td>
                  <td className="text-right tabular-nums">{formatDA(inv.paid)}</td>
                  <td className="text-right tabular-nums">{formatDA(Math.max(0, inv.montant - inv.paid))}</td>
                  <td>{inv.dateOperation ?? (inv.status === "REGLE" ? "" : "en attente")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
