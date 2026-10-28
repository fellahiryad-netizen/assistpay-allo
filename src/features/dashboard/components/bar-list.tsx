import type { AmountBucket } from "@/features/dashboard/types";
import { formatDA } from "@/utils/format";

/** Propriétés d'une liste à barres horizontales. */
export interface BarListProps {
  items: AmountBucket[];
  emptyLabel: string;
}

/** Classement horizontal : libellé, barre proportionnelle, montant et nombre de factures. */
export function BarList({ items, emptyLabel }: Readonly<BarListProps>): React.JSX.Element {
  if (items.length === 0) return <p className="py-6 text-center text-sm text-muted-foreground">{emptyLabel}</p>;
  const max = Math.max(...items.map((item) => item.amount), 1);
  return (
    <ul className="flex flex-col gap-3">
      {items.map((item) => (
        <li key={item.label} title={`${item.label} : ${formatDA(item.amount)} (${item.count} facture${item.count > 1 ? "s" : ""})`}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate">{item.label}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {formatDA(item.amount)} · {item.count}
            </span>
          </div>
          <div className="h-2 rounded-full bg-muted">
            <div className="h-2 rounded-full bg-primary" style={{ width: `${Math.max(2, (item.amount / max) * 100)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
