import { CalendarClock, FileText, PieChart, Wallet, type LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { ReceivablesSummary } from "@/features/receivables/types";
import { formatDA } from "@/utils/format";

function Kpi({ label, value, detail, icon: Icon }: Readonly<{ label: string; value: string; detail: string; icon: LucideIcon }>): React.JSX.Element {
  return (
    <Card className="flex flex-col gap-2 p-4">
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{label}</span>
        <Icon className="size-4" aria-hidden />
      </div>
      <p className="break-words text-xl font-semibold tabular-nums sm:text-2xl">{value}</p>
      <p className="text-xs text-muted-foreground">{detail}</p>
    </Card>
  );
}

/** Quatre indicateurs : créance totale, nombre de factures, compagnie la plus exposée, ancienneté moyenne pondérée. */
export function ReceivablesKpis({ summary }: Readonly<{ summary: ReceivablesSummary }>): React.JSX.Element {
  const top = summary.mostExposed;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Kpi label="Créance totale" value={formatDA(summary.total)} detail={`${summary.companies.length} compagnie(s)`} icon={Wallet} />
      <Kpi label="Factures en attente" value={String(summary.count)} detail={summary.undated.count > 0 ? `dont ${summary.undated.count} sans date` : "toutes datées"} icon={FileText} />
      <Kpi
        label="Compagnie la plus exposée"
        value={top ? top.company : "–"}
        detail={top ? `${top.share.toLocaleString("fr-FR", { minimumFractionDigits: 1 })} % de la créance · ${formatDA(top.amount)}` : "Aucune créance"}
        icon={PieChart}
      />
      <Kpi
        label="Ancienneté moyenne pondérée"
        value={summary.weightedAgeDays === null ? "–" : `${summary.weightedAgeDays.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} jours`}
        detail="Pondérée par les montants, factures datées uniquement"
        icon={CalendarClock}
      />
    </div>
  );
}
