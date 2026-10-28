import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { formatDA } from "@/utils/format";

/** Propriétés d'un indicateur chiffré. */
export interface KpiCardProps {
  label: string;
  amount: number;
  detail: string;
  icon: LucideIcon;
}

/** Indicateur : libellé, montant en dinars et précision. */
export function KpiCard({ label, amount, detail, icon: Icon }: Readonly<KpiCardProps>): React.JSX.Element {
  return (
    <Card className="flex flex-col gap-2 p-4">
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{label}</span>
        <Icon className="size-4" aria-hidden />
      </div>
      <p className="text-xl font-semibold tabular-nums sm:text-2xl">{formatDA(amount)}</p>
      <p className="text-xs text-muted-foreground">{detail}</p>
    </Card>
  );
}
