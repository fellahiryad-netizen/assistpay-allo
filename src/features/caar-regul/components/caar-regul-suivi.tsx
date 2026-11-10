"use client";

import { useState } from "react";
import { CAAR_LABELS, CAAR_SUCCURSALES, CAAR_TRIMESTRES, type CaarRegulIndex, type CaarRegulSaved, type CaarSucc, type Trimestre } from "@/features/caar-regul/services/caar-regul-engine";
import { f0, fm } from "@/features/regul/components/regul-format";
import { REGUL_MOIS } from "@/features/regul/services/regul-engine";
import { cn } from "@/utils/cn";

interface Props {
  index: CaarRegulIndex | null;
  saved: Record<string, CaarRegulSaved>;
  onOpen: (succ: CaarSucc, year: number) => void;
}

interface Cell {
  label: string;
  state: "ok" | "partiel" | "todo" | "vide";
  pa: number;
  title?: string;
}

/** Onglet « Suivi » : 2026 par mois (de mai à décembre), puis par trimestre à partir de 2027. */
export function CaarRegulSuivi({ index, saved, onOpen }: Readonly<Props>): React.JSX.Element {
  const now = new Date().getFullYear();
  const years = [...new Set([2026, now, now + 1, ...Object.values(saved).map((v) => v.annee)])].filter((y) => y >= 2026).sort((a, b) => a - b);
  const [year, setYear] = useState(2026);
  const parTrimestre = year >= 2027;
  const cols: Array<{ label: string; months: number[] }> = parTrimestre
    ? (Object.keys(CAAR_TRIMESTRES) as Trimestre[]).map((t) => ({ label: `Trimestre ${t.slice(1)}`, months: [...CAAR_TRIMESTRES[t]] }))
    : [5, 6, 7, 8, 9, 10, 11, 12].map((m) => ({ label: `${(REGUL_MOIS[m - 1] ?? "").slice(0, 4)}.`, months: [m] }));
  const totC: number[] = cols.map(() => 0);
  let grand = 0;
  let nOk = 0;
  let nTodo = 0;
  const rows = CAAR_SUCCURSALES.map((s) => {
    let tot = 0;
    const cells = cols.map((col, j): Cell => {
      const keys = col.months.map((m) => `${year}-${String(m).padStart(2, "0")}`);
      const sv = keys.map((k) => saved[`${s}-${k}`]).filter((v): v is CaarRegulSaved => Boolean(v));
      const has = keys.some((k) => Boolean(index?.mois[s]?.[k]));
      if (sv.length === col.months.length) {
        const pa = sv.reduce((a, v) => a + v.pa, 0);
        tot += pa;
        totC[j] = (totC[j] ?? 0) + pa;
        nOk++;
        return { label: f0(pa), state: "ok", pa, title: `Régule ${fm(sv.reduce((a, v) => a + v.regule, 0))} · avance ${fm(sv.reduce((a, v) => a + v.avance, 0))} · écart HT ${fm(sv.reduce((a, v) => a + v.ecart, 0))}` };
      }
      if (sv.length) {
        nTodo++;
        return { label: `${sv.length}/${col.months.length} mois`, state: "partiel", pa: 0 };
      }
      if (has) {
        nTodo++;
        return { label: "à faire", state: "todo", pa: 0 };
      }
      return { label: "—", state: "vide", pa: 0 };
    });
    grand += tot;
    return { s, cells, tot };
  });
  const unite = parTrimestre ? "trimestres" : "mois";
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-2 sm:grid-cols-3">
        {[
          [`${f0(grand)} DA`, `Régularisation TTC ${year}`],
          [String(nOk), `${unite} régularisés`],
          [String(nTodo), `${unite} à faire`],
        ].map(([v, l]) => (
          <div key={l} className="rounded-lg border bg-card p-3">
            <span className="block text-lg font-semibold tabular-nums">{v}</span>
            <span className="text-xs text-muted-foreground">{l}</span>
          </div>
        ))}
      </div>
      <div className="flex gap-1">
        {years.map((y) => (
          <button key={y} type="button" onClick={() => setYear(y)} className={cn("rounded-md border px-3 py-1 text-sm", year === y && "bg-primary text-primary-foreground")}>
            {y}
          </button>
        ))}
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="bg-muted/50 text-xs">
              <th className="px-2 py-2 text-left">Succursale</th>
              {cols.map((c) => <th key={c.label} className="px-2 py-2 text-right">{c.label}</th>)}
              <th className="px-2 py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.s} className="cursor-pointer border-t hover:bg-muted/40" onClick={() => onOpen(r.s, year)}>
                <td className="px-2 py-1.5 font-medium">{CAAR_LABELS[r.s]}</td>
                {r.cells.map((c, j) => (
                  <td key={cols[j]?.label ?? j} className="px-2 py-1.5 text-right tabular-nums" title={c.title}>
                    {c.state === "ok" ? (
                      <span className={c.pa < 0 ? "text-destructive" : ""}>
                        <span className="mr-1 text-success">✔</span>
                        {c.label}
                      </span>
                    ) : c.state === "vide" ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <span className="rounded-full bg-warning/20 px-2 py-0.5 text-xs">{c.label}</span>
                    )}
                  </td>
                ))}
                <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{r.tot ? f0(r.tot) : "—"}</td>
              </tr>
            ))}
            <tr className="border-t-2 bg-muted/50 font-semibold">
              <td className="px-2 py-2">Total</td>
              {totC.map((v, j) => <td key={cols[j]?.label ?? j} className="px-2 py-2 text-right tabular-nums">{v ? f0(v) : "—"}</td>)}
              <td className="px-2 py-2 text-right tabular-nums">{f0(grand)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Régularisation TTC (écart HT + TVA 19 %) à facturer, en DA. 2026 : de mai (début du partenariat) à décembre ; à partir de 2027, par trimestre. « à faire » = période présente dans le consolidé mais pas encore régularisée. Un clic sur une ligne ouvre la succursale.
      </p>
    </div>
  );
}
