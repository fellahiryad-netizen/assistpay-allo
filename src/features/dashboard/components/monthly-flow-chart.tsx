import type { MonthlyFlow } from "@/features/dashboard/types";
import { formatCompact, formatDA } from "@/utils/format";

/** Propriétés du graphique des flux mensuels. */
export interface MonthlyFlowChartProps {
  data: MonthlyFlow[];
  showCredit: boolean;
  showDebit: boolean;
}

const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const WIDTH = 720;
const HEIGHT = 240;
const PAD = { top: 12, right: 8, bottom: 28, left: 52 };

function monthLabel(month: string): string {
  const index = Number(month.slice(5, 7)) - 1;
  return `${MONTHS[index] ?? month} ${month.slice(2, 4)}`;
}

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((candidate) => candidate * power >= value) ?? 10;
  return step * power;
}

/**
 * Encaissements et décaissements réglés des 12 derniers mois, en barres groupées sur un seul axe.
 * Survol d'une barre : montant exact (infobulle). Un tableau équivalent est fourni aux lecteurs d'écran.
 */
export function MonthlyFlowChart({ data, showCredit, showDebit }: Readonly<MonthlyFlowChartProps>): React.JSX.Element {
  const series = [
    ...(showCredit ? [{ key: "encaisse" as const, label: "Encaissé", className: "fill-primary", swatch: "bg-primary" }] : []),
    ...(showDebit ? [{ key: "decaisse" as const, label: "Décaissé", className: "fill-accent", swatch: "bg-accent" }] : []),
  ];
  const max = niceMax(Math.max(0, ...data.flatMap((row) => series.map((serie) => row[serie.key]))));
  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const slot = plotW / Math.max(1, data.length);
  const barW = Math.min(18, (slot - 8) / Math.max(1, series.length) - 2);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => ratio * max);
  const y = (value: number): number => PAD.top + plotH - (value / max) * plotH;

  return (
    <figure className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground" aria-hidden>
        {series.map((serie) => (
          <span key={serie.key} className="inline-flex items-center gap-1.5">
            <span className={`size-2.5 rounded-sm ${serie.swatch}`} />
            {serie.label}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-auto w-full" role="img" aria-label="Flux réglés des 12 derniers mois">
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y(tick)} y2={y(tick)} className="stroke-border" strokeWidth={1} />
            <text x={PAD.left - 8} y={y(tick)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-xs">
              {formatCompact(tick)}
            </text>
          </g>
        ))}
        {data.map((row, index) => {
          const groupX = PAD.left + index * slot + (slot - series.length * (barW + 2)) / 2;
          return (
            <g key={row.month}>
              {series.map((serie, serieIndex) => {
                const value = row[serie.key];
                const top = y(value);
                const height = Math.max(0, PAD.top + plotH - top);
                return (
                  <rect
                    key={serie.key}
                    x={groupX + serieIndex * (barW + 2)}
                    y={top}
                    width={barW}
                    height={height}
                    rx={Math.min(4, barW / 2)}
                    className={serie.className}
                  >
                    <title>{`${serie.label} ${monthLabel(row.month)} : ${formatDA(value)}`}</title>
                  </rect>
                );
              })}
              <text x={PAD.left + index * slot + slot / 2} y={HEIGHT - 8} textAnchor="middle" className="fill-muted-foreground text-xs">
                {monthLabel(row.month)}
              </text>
            </g>
          );
        })}
      </svg>
      <table className="sr-only">
        <caption>Flux réglés par mois</caption>
        <thead>
          <tr>
            <th scope="col">Mois</th>
            {series.map((serie) => (
              <th key={serie.key} scope="col">
                {serie.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr key={row.month}>
              <th scope="row">{monthLabel(row.month)}</th>
              {series.map((serie) => (
                <td key={serie.key}>{formatDA(row[serie.key])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
