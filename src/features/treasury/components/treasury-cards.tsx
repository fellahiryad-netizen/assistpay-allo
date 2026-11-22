import { MINIMUM_LABEL, minimumExplanation } from "@/features/treasury/lib/minimum";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { IssuedCheque } from "@/features/treasury/lib/circulation";
import type { TreasuryComputation } from "@/features/treasury/lib/compute";
import { daysLabel, millions } from "@/features/treasury/lib/format";
import type { BalanceView } from "@/features/treasury/types/view";
import { formatDA, formatDate } from "@/utils/format";

/** Grande carte « Solde du compte AGB », avec les chèques non encore débités et le solde disponible estimé. */
export function BalanceCard({ balance, computation, cheques }: Readonly<{ balance: BalanceView; computation: TreasuryComputation; cheques: IssuedCheque[] }>): React.JSX.Element {
  return (
    <Card className="p-4 sm:p-6">
      <p className="text-sm font-medium text-muted-foreground">Solde du compte AGB au {formatDate(balance.date)}</p>
      <p className="mt-1 text-3xl font-extrabold tabular-nums tracking-tight sm:text-5xl">{formatDA(computation.bank)}</p>
      <ul className="mt-3 space-y-1 text-sm sm:text-base">
        {cheques.map((cheque) => (
          <li key={`${cheque.source}-${cheque.id}`}>
            moins le chèque {cheque.numero}
            {cheque.beneficiaire ? ` (${cheque.beneficiaire}${cheque.libelle ? `, ${cheque.libelle}` : ""})` : ""} non encore encaissé par la banque : <b className="tabular-nums">{formatDA(cheque.montant)}</b>
          </li>
        ))}
        {computation.adjustment !== 0 ? (
          <li>
            mouvements du CRM postérieurs au relevé (<Badge variant="warning">non confirmés par le relevé</Badge>) : <b className="tabular-nums">{formatDA(computation.adjustment)}</b>
          </li>
        ) : null}
      </ul>
      <p className="mt-3 border-t pt-3 text-base sm:text-lg">
        Solde disponible estimé : <b className="text-xl tabular-nums sm:text-2xl">{formatDA(computation.available)}</b>
      </p>
    </Card>
  );
}

function Kpi({ label, value, detail }: Readonly<{ label: string; value: string; detail: string }>): React.JSX.Element {
  return (
    <Card className="p-4">
      <p className="text-sm font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-extrabold tabular-nums sm:text-3xl">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground sm:text-sm">{detail}</p>
    </Card>
  );
}

/** Quatre indicateurs : reste à payer, solde après paiements, couverture, minimum de trésorerie. */
export function Kpis({ computation }: Readonly<{ computation: TreasuryComputation }>): React.JSX.Element {
  const ratio = computation.coverageRatio;
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Kpi
        label="Reste à payer"
        value={millions(computation.totalToPay)}
        detail={`${formatDA(computation.totalToPay)}${computation.simulationTotal > 0 ? ` dont ${millions(computation.simulationTotal)} simulés` : ""}${computation.preparedTotal > 0 ? ` · dont déjà dans des virements préparés : ${millions(computation.preparedTotal)}` : ""}`}
      />
      <Kpi label="Solde après paiements" value={millions(computation.balanceAfter)} detail={`Disponible ${millions(computation.available)} − reste à payer${computation.coverageDays !== null ? ` · environ ${daysLabel(Math.max(0, computation.coverageDays))} de dépenses` : ""}`} />
      <Kpi label="Couverture" value={ratio === null ? "sans objet" : ratio.toFixed(2).replace(".", ",")} detail={ratio === null ? "Rien à payer." : `Le disponible couvre ${Math.round(ratio * 100)} % de ce qui reste à payer.`} />
      <Kpi
        label={MINIMUM_LABEL}
        value={millions(computation.cushion)}
        detail={minimumExplanation(computation)}
      />
    </div>
  );
}
