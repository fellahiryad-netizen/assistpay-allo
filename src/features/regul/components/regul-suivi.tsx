"use client";

import { useState } from "react";
import { f0, fm } from "@/features/regul/components/regul-format";
import { faitsOf } from "@/features/regul/services/regul-checks";
import { REGUL_LABELS, REGUL_MOIS, REGUL_SUCCURSALES, type RegulIndex, type RegulSaved } from "@/features/regul/services/regul-engine";
import { cn } from "@/utils/cn";

/** Onglet « Suivi » : Part Assisteur régularisée par succursale et par mois, pour 2026, 2025 et décembre 2024. */
export function RegulSuivi({ index, saved, onOpen }: Readonly<{ index: RegulIndex | null; saved: Record<string, RegulSaved>; onOpen: (succ: string) => void }>): React.JSX.Element {
  const [year, setYear] = useState(2026);
  const mm = Array.from({ length: 12 }, (_, k) => k + 1);
  const totM: Record<number, number> = {};
  let grand = 0;
  let nOk = 0;
  let nTodo = 0;
  const rows = REGUL_SUCCURSALES.map((s) => {
    let tot = 0;
    const cells = mm.map((m) => {
      const k = `${year}-${String(m).padStart(2, "0")}`;
      const st = faitsOf(index, saved, s, k);
      const has = year === 2026 && Boolean(index?.tcd?.[s]?.[k]);
      if (st) {
        tot += st.pa;
        totM[m] = (totM[m] ?? 0) + st.pa;
        nOk++;
      } else if (has) nTodo++;
      return { m, st, has };
    });
    grand += tot;
    return { s, cells, tot };
  });
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-2 sm:grid-cols-3">
        {[
          [`${f0(grand)} DA`, `Part Assisteur régularisée ${year === 2024 ? "(déc. 2024)" : year}`],
          [String(nOk), "mois régularisés"],
          [String(nTodo), "mois à faire"],
        ].map(([v, l]) => (
          <div key={l} className="rounded-lg border bg-card p-3">
            <span className="block text-lg font-semibold tabular-nums">{v}</span>
            <span className="text-xs text-muted-foreground">{l}</span>
          </div>
        ))}
      </div>
      <div className="flex gap-1">
        {[2026, 2025, 2024].map((y) => (
          <button key={y} type="button" onClick={() => setYear(y)} className={cn("rounded-md border px-3 py-1 text-sm", year === y && "bg-primary text-primary-foreground")}>
            {y === 2024 ? "Déc. 2024" : y}
          </button>
        ))}
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="bg-muted/50 text-xs">
              <th className="px-2 py-2 text-left">Succursale</th>
              {mm.map((m) => (
                <th key={m} className="px-2 py-2 text-right">{(REGUL_MOIS[m - 1] ?? "").slice(0, 4)}.</th>
              ))}
              <th className="px-2 py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.s} className="cursor-pointer border-t hover:bg-muted/40" onClick={() => onOpen(r.s)}>
                <td className="px-2 py-1.5 font-medium">{REGUL_LABELS[r.s]}</td>
                {r.cells.map(({ m, st, has }) => (
                  <td key={m} className="px-2 py-1.5 text-right tabular-nums" title={st ? `Régule ${fm(st.regule)} · avance ${fm(st.avance)} · source ${st.src}` : undefined}>
                    {st ? (
                      <span className={st.pa < 0 ? "text-destructive" : ""}>
                        <span className="mr-1 text-success">✔</span>
                        {f0(st.pa)}
                      </span>
                    ) : has ? (
                      <span className="rounded-full bg-warning/20 px-2 py-0.5 text-xs">à faire</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                ))}
                <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{r.tot ? f0(r.tot) : "—"}</td>
              </tr>
            ))}
            <tr className="border-t-2 bg-muted/50 font-semibold">
              <td className="px-2 py-2">Total</td>
              {mm.map((m) => (
                <td key={m} className="px-2 py-2 text-right tabular-nums">{totM[m] ? f0(totM[m]) : "—"}</td>
              ))}
              <td className="px-2 py-2 text-right tabular-nums">{f0(grand)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Part Assisteur (10 % HT + TVA) à facturer, en DA. ✔ = régularisé (source : AssistPay ou classeur) ; rouge = part négative ; « à faire » = production en base mais régularisation pas encore faite. Un clic sur une ligne ouvre la succursale.
      </p>
    </div>
  );
}
