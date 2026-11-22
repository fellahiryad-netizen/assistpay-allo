import type { TimelinePoint } from "@/features/treasury/lib/risk";
import type { DailyBalance } from "@/features/treasury/types";
import { daysBetween } from "@/utils/dates";
import { formatDA, formatDate } from "@/utils/format";

/** Propriétés du graphique « Évolution prévue du solde » (données sérialisables). */
export interface BalanceChartProps {
  /** Solde bancaire à la date du solde (avant chèques en circulation et mouvements non confirmés). */
  bank: number;
  /** Soldes de fin de journée du relevé (trait plein). */
  history: readonly DailyBalance[];
  /** Projection prudente (pointillé). */
  projection: readonly TimelinePoint[];
  /** Réserve conseillée (ligne). */
  cushion: number;
  lowest: { date: string; balance: number };
  overdraftDate: string | null;
  /** Noir et blanc, sans remplissage : version imprimée. */
  mono?: boolean;
}

const W = 820;
const H = 320;
const M = { left: 64, right: 16, top: 20, bottom: 36 };

const millionsShort = (value: number): string => `${(value / 1_000_000).toFixed(0)} M`;

/**
 * Graphique SVG maison : historique en trait plein, projection prudente en pointillé, encaissements attendus hachurés (« attendu, non garanti »),
 * ligne de réserve conseillée, ligne zéro, point bas et première date de découvert annotés. Les couleurs viennent des variables du thème (clair et sombre).
 */
export function BalanceChart({ bank, history, projection, cushion, lowest, overdraftDate, mono = false }: Readonly<BalanceChartProps>): React.JSX.Element {
  const first = history[0]?.d ?? projection[0]?.date ?? "";
  const last = projection[projection.length - 1]?.date ?? history[history.length - 1]?.d ?? first;
  const span = Math.max(1, daysBetween(first, last));
  const hasExpected = projection.some((point) => point.expected !== null);
  const start = projection[0];
  const jump = start && Math.abs(bank - start.balance) >= 0.5 ? { date: start.date, from: bank, to: start.balance } : null;
  const values = [0, cushion, ...(jump ? [jump.from] : []), ...history.map((p) => p.b), ...projection.map((p) => p.balance), ...projection.map((p) => p.expected ?? p.balance)];
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const pad = (rawMax - rawMin) * 0.08 || 1;
  const yMin = rawMin - pad;
  const yMax = rawMax + pad;
  const x = (date: string): number => M.left + (daysBetween(first, date) / span) * (W - M.left - M.right);
  const y = (value: number): number => M.top + (1 - (value - yMin) / (yMax - yMin)) * (H - M.top - M.bottom);
  const path = (points: ReadonlyArray<[string, number]>): string => points.map(([date, value], index) => `${index === 0 ? "M" : "L"}${x(date).toFixed(1)},${y(value).toFixed(1)}`).join(" ");

  const historyPath = path(history.map((p) => [p.d, p.b]));
  const projectionPath = path(projection.map((p) => [p.date, p.balance]));
  const expectedPoints = projection.filter((p): p is TimelinePoint & { expected: number } => p.expected !== null);
  const expectedPath = path(expectedPoints.map((p) => [p.date, p.expected]));
  const band =
    hasExpected && expectedPoints.length > 1
      ? `${path(expectedPoints.map((p) => [p.date, p.expected]))} ${[...projection].reverse().map((p) => `L${x(p.date).toFixed(1)},${y(p.balance).toFixed(1)}`).join(" ")} Z`
      : "";

  const ink = mono ? "#000" : "hsl(var(--foreground))";
  const primary = mono ? "#000" : "hsl(var(--primary))";
  const warn = mono ? "#000" : "hsl(var(--warning))";
  const danger = mono ? "#000" : "hsl(var(--destructive))";
  const muted = mono ? "#000" : "hsl(var(--muted-foreground))";
  const ticks = Array.from({ length: 5 }, (_, index) => yMin + ((yMax - yMin) * index) / 4);
  const summary = `Solde disponible de ${formatDate(projection[0]?.date ?? first)} à ${formatDate(last)} : point bas ${millionsShort(lowest.balance)} DA le ${formatDate(lowest.date)}${overdraftDate ? `, découvert dès le ${formatDate(overdraftDate)}` : ", pas de découvert"}.`;

  // Tableau accessible : un point réel par semaine et le dernier, puis le départ de la projection, chaque jour où le solde prévu change, le point bas et le dernier jour.
  const rows: Array<{ date: string; kind: string; balance: number }> = [];
  history.forEach((point, index) => {
    if (index % 7 === 0 || index === history.length - 1) rows.push({ date: point.d, kind: "Réel (relevé)", balance: point.b });
  });
  projection.forEach((point, index) => {
    const previous = projection[index - 1];
    const changed = index === 0 || index === projection.length - 1 || previous?.balance !== point.balance;
    if (changed) rows.push({ date: point.date, kind: index === 0 ? "Prévu : départ (disponible après chèques en circulation)" : point.date === lowest.date ? "Prévu : point bas" : "Prévu", balance: point.balance });
  });

  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary} className="h-auto w-full" style={{ maxHeight: 360 }}>
        <title>Évolution prévue du solde</title>
        <desc>{summary}</desc>
        <defs>
          <pattern id="tr-hatch" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" stroke={primary} strokeWidth="1.5" />
          </pattern>
        </defs>
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={M.left} x2={W - M.right} y1={y(tick)} y2={y(tick)} stroke={mono ? "#000" : muted} strokeOpacity={mono ? 1 : 0.25} strokeWidth={mono ? 0.75 : 1} />
            <text x={M.left - 8} y={y(tick) + 4} textAnchor="end" fontSize="12" fill={ink}>
              {millionsShort(tick)}
            </text>
          </g>
        ))}
        <line x1={M.left} x2={W - M.right} y1={y(0)} y2={y(0)} stroke={danger} strokeWidth={mono ? 2.5 : 2} />
        <text x={W - M.right - 4} y={y(0) - 5} textAnchor="end" fontSize="12" fontWeight="700" fill={danger}>
          Zéro
        </text>
        {cushion > 0 ? (
          <>
            <line x1={M.left} x2={W - M.right} y1={y(cushion)} y2={y(cushion)} stroke={warn} strokeWidth={mono ? 2.5 : 2} strokeDasharray="2 5" strokeLinecap="round" />
            <text x={M.left + 6} y={y(cushion) - 5} fontSize="12" fontWeight="700" fill={mono ? "#000" : warn}>
              Réserve conseillée {millionsShort(cushion)}
            </text>
          </>
        ) : null}
        {band && !mono ? <path d={band} fill="url(#tr-hatch)" fillOpacity="0.45" stroke="none" /> : null}
        {historyPath ? <path d={historyPath} fill="none" stroke={primary} strokeWidth={mono ? 3 : 2.5} strokeLinejoin="round" /> : null}
        <path d={projectionPath} fill="none" stroke={primary} strokeWidth={mono ? 3 : 2.5} strokeDasharray="9 6" strokeLinejoin="round" />
        {hasExpected ? <path d={expectedPath} fill="none" stroke={primary} strokeWidth="2" strokeDasharray="2 4" strokeLinecap="round" /> : null}
        {jump ? (
          <g>
            <line x1={x(jump.date)} x2={x(jump.date)} y1={y(jump.from)} y2={y(jump.to)} stroke={ink} strokeWidth="3" />
            <circle cx={x(jump.date)} cy={y(jump.from)} r="4.5" fill={ink} />
            <path d={`M${x(jump.date) - 6},${y(jump.to) - 7} L${x(jump.date)},${y(jump.to)} L${x(jump.date) + 6},${y(jump.to) - 7}`} fill="none" stroke={ink} strokeWidth="3" />
            <text x={x(jump.date) + 12} y={(y(jump.from) + y(jump.to)) / 2 + 4} fontSize="12" fontWeight="700" fill={ink}>
              Solde réel {millionsShort(jump.from)} → disponible {millionsShort(jump.to)}
            </text>
          </g>
        ) : null}
        <circle cx={x(lowest.date)} cy={y(lowest.balance)} r="6" fill={mono ? "#fff" : "hsl(var(--card))"} stroke={ink} strokeWidth="3" />
        <text x={Math.min(x(lowest.date) + 10, W - 160)} y={y(lowest.balance) - 12} fontSize="12" fontWeight="700" fill={ink}>
          Point bas {millionsShort(lowest.balance)} ({formatDate(lowest.date).slice(0, 5)})
        </text>
        {overdraftDate ? (
          <g>
            <line x1={x(overdraftDate)} x2={x(overdraftDate)} y1={M.top} y2={H - M.bottom} stroke={danger} strokeWidth="2" strokeDasharray="4 3" />
            <text x={Math.min(x(overdraftDate) + 6, W - 150)} y={M.top + 12} fontSize="12" fontWeight="700" fill={danger}>
              Découvert dès le {formatDate(overdraftDate).slice(0, 5)}
            </text>
          </g>
        ) : null}
        <text x={M.left} y={H - 10} fontSize="12" fill={ink}>
          {formatDate(first)}
        </text>
        <text x={W - M.right} y={H - 10} fontSize="12" textAnchor="end" fill={ink}>
          {formatDate(last)}
        </text>
      </svg>
      <figcaption className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
        <span>
          <b aria-hidden>━</b> Réel (relevé)
        </span>
        <span>
          <b aria-hidden>╌╌</b> Prévu, sans encaissement
        </span>
        {hasExpected ? (
          <span>
            <b aria-hidden>▨</b> Attendu, non garanti
          </span>
        ) : null}
        <span>
          <b aria-hidden>···</b> Réserve conseillée
        </span>
        {jump ? (
          <span>
            <b aria-hidden>↓</b> Chèques en circulation et mouvements non confirmés : du solde réel au disponible
          </span>
        ) : null}
      </figcaption>
      {mono ? null : (
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer font-semibold">Voir les points du graphique sous forme de tableau</summary>
          <div className="mt-2 max-h-80 overflow-auto">
            <table className="w-full border-collapse text-left">
              <caption className="sr-only">Points du graphique : solde réel puis solde prévu, en DA</caption>
              <thead>
                <tr>
                  <th scope="col" className="border-b p-1">Date</th>
                  <th scope="col" className="border-b p-1">Nature du point</th>
                  <th scope="col" className="border-b p-1 text-right">Solde (DA)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={`${row.kind}-${row.date}`}>
                    <td className="border-b p-1">{formatDate(row.date)}</td>
                    <td className="border-b p-1">{row.kind}</td>
                    <td className="border-b p-1 text-right tabular-nums">{formatDA(row.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </figure>
  );
}
