import { AGING_BUCKETS, type AgingKey } from "@/features/receivables/lib/aging";
import type { ReceivablesSummary } from "@/features/receivables/types";
import { formatDA } from "@/utils/format";

/** Couleurs des tranches : du plus récent (vert) au plus ancien (rouge), gris pour « sans date ». */
const AGING_COLORS: Readonly<Record<AgingKey, string>> = {
  D0_30: "#0E7C5A",
  D31_60: "#8A6D00",
  D61_90: "#C25A00",
  D90_PLUS: "#B3261E",
  SANS_DATE: "#6B7280",
};

/** Barres horizontales empilées : ancienneté des créances par compagnie (largeur proportionnelle au montant). */
export function AgingStackChart({ summary }: Readonly<{ summary: ReceivablesSummary }>): React.JSX.Element {
  const max = Math.max(...summary.companies.map((row) => row.amount), 0);
  if (max <= 0) return <p className="py-6 text-center text-sm text-muted-foreground">Rien en attente.</p>;
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label="Légende des tranches d'ancienneté">
        {AGING_BUCKETS.map((bucket) => (
          <li key={bucket.key} className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ backgroundColor: AGING_COLORS[bucket.key] }} />
            {bucket.label}
          </li>
        ))}
      </ul>
      <ul className="flex flex-col gap-2.5">
        {summary.companies.map((row) => (
          <li key={row.company} className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-3 text-sm sm:grid-cols-[8rem_minmax(0,1fr)_9rem]">
            <span className="truncate font-medium">{row.company}</span>
            <div className="flex h-5 overflow-hidden rounded bg-muted" style={{ width: `${(row.amount / max) * 100}%`, minWidth: "0.5rem" }}>
              {AGING_BUCKETS.map((bucket) => {
                const part = row.aging[bucket.key];
                if (part.amount <= 0) return null;
                return (
                  <div key={bucket.key} style={{ width: `${(part.amount / row.amount) * 100}%`, backgroundColor: AGING_COLORS[bucket.key] }} title={`${row.company} · ${bucket.label} : ${formatDA(part.amount)} (${part.count} facture${part.count > 1 ? "s" : ""})`} />
                );
              })}
            </div>
            <span className="col-span-2 text-right text-xs tabular-nums text-muted-foreground sm:col-span-1">{formatDA(row.amount)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
