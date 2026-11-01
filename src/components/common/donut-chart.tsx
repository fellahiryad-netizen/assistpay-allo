"use client";

import { useState } from "react";
import { cn } from "@/utils/cn";
import { formatDA } from "@/utils/format";

/** Part d'un anneau. */
export interface DonutSlice {
  label: string;
  amount: number;
  count: number;
}

const PALETTE: ReadonlyArray<[string, string]> = [
  ["#ff8a3d", "#ff5e1a"],
  ["#a855f7", "#6d28d9"],
  ["#22d3ee", "#0891b2"],
  ["#f43f5e", "#be123c"],
  ["#34d399", "#059669"],
  ["#facc15", "#ca8a04"],
  ["#60a5fa", "#2563eb"],
  ["#f472b6", "#db2777"],
];
const OTHERS = "#64748b";
const R = 70;
const CIRC = 2 * Math.PI * R;

/**
 * Anneau « futuriste » : arcs dégradés avec halo lumineux, total au centre, légende interactive.
 * Au-delà de 7 parts, les plus petites sont regroupées dans « Autres ».
 */
export function DonutChart({ slices, centerLabel, unit = "facture" }: Readonly<{ slices: DonutSlice[]; centerLabel: string; unit?: string }>): React.JSX.Element {
  const [active, setActive] = useState<number | null>(null);
  const sorted = [...slices].filter((slice) => slice.amount > 0).sort((a, b) => b.amount - a.amount);
  const head = sorted.slice(0, 7);
  const rest = sorted.slice(7);
  const parts: DonutSlice[] = rest.length ? [...head, { label: "Autres", amount: rest.reduce((s, x) => s + x.amount, 0), count: rest.reduce((s, x) => s + x.count, 0) }] : head;
  const total = parts.reduce((sum, part) => sum + part.amount, 0);
  if (total <= 0) return <p className="py-6 text-center text-sm text-muted-foreground">Rien en attente.</p>;
  let offset = 0;
  const arcs = parts.map((part, index) => {
    const length = (part.amount / total) * CIRC;
    const gap = parts.length > 1 ? Math.min(3, length * 0.2) : 0;
    const arc = { part, index, dash: Math.max(length - gap, 0.5), offset };
    offset += length;
    return arc;
  });
  const shown = active !== null ? parts[active] : null;
  const colorOf = (index: number): [string, string] => (parts[index]?.label === "Autres" && rest.length ? [OTHERS, OTHERS] : (PALETTE[index % PALETTE.length] ?? PALETTE[0] ?? ["#999", "#666"]));
  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center">
      <div className="relative size-52 shrink-0">
        <div aria-hidden className="absolute inset-3 rounded-full bg-[radial-gradient(circle,hsl(var(--primary)/0.18),transparent_70%)] blur-xl" />
        <svg viewBox="0 0 180 180" className="relative size-full -rotate-90" role="img" aria-label={`${centerLabel} : ${formatDA(total)}`}>
          <defs>
            {parts.map((_, index) => (
              <linearGradient key={index} id={`donut-g${index}`} x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor={colorOf(index)[0]} />
                <stop offset="100%" stopColor={colorOf(index)[1]} />
              </linearGradient>
            ))}
            <filter id="donut-glow" x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="2.4" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <circle cx="90" cy="90" r={R + 14} fill="none" stroke="currentColor" strokeOpacity="0.12" strokeWidth="0.8" strokeDasharray="1.5 4" />
          <circle cx="90" cy="90" r={R - 14} fill="none" stroke="currentColor" strokeOpacity="0.12" strokeWidth="0.8" />
          <circle cx="90" cy="90" r={R} fill="none" stroke="currentColor" strokeOpacity="0.07" strokeWidth="16" />
          {arcs.map(({ part, index, dash, offset: start }) => (
            <circle
              key={part.label}
              cx="90"
              cy="90"
              r={R}
              fill="none"
              stroke={`url(#donut-g${index})`}
              strokeWidth={active === index ? 21 : 16}
              strokeLinecap="butt"
              strokeDasharray={`${dash} ${CIRC - dash}`}
              strokeDashoffset={-start}
              filter="url(#donut-glow)"
              opacity={active === null || active === index ? 1 : 0.35}
              className="cursor-pointer transition-all duration-200"
              onMouseEnter={() => setActive(index)}
              onMouseLeave={() => setActive(null)}
            >
              <title>{`${part.label} : ${formatDA(part.amount)} (${part.count} ${unit}${part.count > 1 ? "s" : ""})`}</title>
            </circle>
          ))}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-9 text-center">
          <span className="line-clamp-2 text-[11px] uppercase tracking-wider text-muted-foreground">{shown ? shown.label : centerLabel}</span>
          <span className="text-base font-semibold tabular-nums leading-tight">{formatDA(shown ? shown.amount : total)}</span>
          <span className="text-[11px] text-muted-foreground">{shown ? `${Math.round((shown.amount / total) * 1000) / 10} % · ${shown.count} ${unit}${shown.count > 1 ? "s" : ""}` : `${parts.reduce((s, x) => s + x.count, 0)} ${unit}s`}</span>
        </div>
      </div>
      <ul className="grid w-full min-w-0 flex-1 gap-1.5 text-sm">
        {parts.map((part, index) => (
          <li
            key={part.label}
            onMouseEnter={() => setActive(index)}
            onMouseLeave={() => setActive(null)}
            className={cn("flex items-center gap-2 rounded-md px-2 py-1 transition-colors", active === index && "bg-muted")}
          >
            <span className="size-2.5 shrink-0 rounded-full shadow-[0_0_8px_currentColor]" style={{ background: colorOf(index)[0], color: colorOf(index)[0] }} />
            <span className="min-w-0 flex-1 truncate">{part.label}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">{formatDA(part.amount)}</span>
            <span className="w-12 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{Math.round((part.amount / total) * 1000) / 10} %</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
