"use client";

import { useMemo, useState } from "react";
import { f0, fm } from "@/features/regul/components/regul-format";
import { ctrlRows } from "@/features/regul/services/regul-checks";
import { REGUL_LABELS, REGUL_MOIS, type RegulIndex, type RegulSaved } from "@/features/regul/services/regul-engine";

/** Onglet « Contrôle qualité » : chaque régularisation rapprochée de la production en base. */
export function RegulCtrl({ index, saved }: Readonly<{ index: RegulIndex | null; saved: Record<string, RegulSaved> }>): React.JSX.Element {
  const [all, setAll] = useState(false);
  const rows = useMemo(() => ctrlRows(index, saved), [index, saved]);
  const bad = rows.filter((r) => r.fl.length);
  const shown = all ? rows : bad;
  const impact = bad.filter((r) => r.gap < 0 && r.y === 2026).reduce((a, r) => a + r.impact, 0);
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-2 sm:grid-cols-3">
        {[
          [String(rows.length), "régularisations contrôlées (déc. 2024 → 2026)"],
          [String(bad.length), "à justifier"],
          [`${f0(impact)} DA`, "Part Assisteur 2026 en jeu si la production absente est confirmée"],
        ].map(([v, l]) => (
          <div key={l} className="rounded-lg border bg-card p-3">
            <span className="block text-lg font-semibold tabular-nums">{v}</span>
            <span className="text-xs text-muted-foreground">{l}</span>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Chaque régularisation est rapprochée de la production en base : montant régularisé comparé à la production du mois (seuil 5 % et 5 000 DA), avance comparée à 90 % de la production, arithmétique et relevé bancaire. Les agences qui expliquent l&apos;écart sont indiquées lorsqu&apos;elles sont connues (écart en DA, fichier − base).
      </p>
      <label className="inline-flex items-center gap-2 text-sm">
        <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Afficher aussi les régularisations conformes
      </label>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[980px] text-sm">
          <thead>
            <tr className="bg-muted/50 text-xs">
              <th className="px-2 py-2 text-left">Succursale</th>
              <th className="px-2 py-2 text-left">Mois</th>
              {["Production (base)", "Régularisé", "Écart", "Avance", "Part Assisteur"].map((h) => (
                <th key={h} className="px-2 py-2 text-right">{h}</th>
              ))}
              <th className="px-2 py-2 text-left">Constat</th>
            </tr>
          </thead>
          <tbody>
            {shown.length ? (
              shown.map((r) => (
                <tr key={`${r.s}${r.k}`} className="border-t align-top">
                  <td className="px-2 py-1.5 font-medium">{REGUL_LABELS[r.s]}</td>
                  <td className="px-2 py-1.5">{(REGUL_MOIS[Number(r.k.slice(5)) - 1] ?? "").slice(0, 4)}. {r.y}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fm(r.base)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fm(r.regule)}</td>
                  <td className={`px-2 py-1.5 text-right tabular-nums ${Math.abs(r.pct) >= 0.05 ? "text-destructive" : ""}`}>
                    {fm(r.gap)} <span className="text-xs text-muted-foreground">({(r.pct * 100).toFixed(1).replace(".", ",")} %)</span>
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fm(r.avance)}</td>
                  <td className={`px-2 py-1.5 text-right tabular-nums ${r.pa < 0 ? "text-destructive" : ""}`}>{fm(r.pa)}</td>
                  <td className="px-2 py-1.5">
                    {r.fl.length ? r.fl.map((x) => <span key={x} className="mr-1 inline-block rounded-full bg-warning/25 px-2 py-0.5 text-xs">{x}</span>) : <span className="rounded-full bg-success/15 px-2 py-0.5 text-xs text-success">conforme</span>}
                    {r.top ? <div className="text-xs text-muted-foreground">Agences : {r.top}</div> : null}
                    {r.impact && r.fl.length && r.y === 2026 ? <div className="text-xs text-muted-foreground">Impact potentiel : +{f0(r.impact)} DA</div> : null}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={8} className="px-2 py-3 text-muted-foreground">Rien à signaler.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
