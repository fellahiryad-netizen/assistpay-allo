import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { LineActions } from "@/features/statement/components/line-actions";
import { STATEMENT_STATUS_LABELS, type StatementLineDTO } from "@/features/statement/types";
import { cn } from "@/utils/cn";
import { formatDA, formatDate } from "@/utils/format";

/** Propriétés de la liste des lignes du relevé. */
export interface StatementLinesProps {
  lines: StatementLineDTO[];
  canEdit: boolean;
  categories: string[];
}

const MODE: Readonly<Record<string, string>> = { CHEQUE: "Chèque", VIRMT: "Virement", VRSMT: "Versement" };

/** Lignes du relevé avec leurs indices (doublon probable, envoi de virements, paie) et leurs actions. */
export function StatementLines({ lines, canEdit, categories }: Readonly<StatementLinesProps>): React.JSX.Element {
  return (
    <ul className="flex flex-col divide-y rounded-lg border bg-card">
      {lines.map((line) => (
        <li key={line.id} className="flex flex-col gap-2 p-3 md:flex-row md:items-start md:gap-4">
          <div className="w-24 shrink-0 text-sm tabular-nums">{formatDate(line.date)}</div>
          <div className="min-w-0 flex-1">
            <p className="break-words text-sm">{line.libelle || "—"}</p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {line.type ? (
                <Badge variant="muted">
                  {MODE[line.type] ?? line.type}
                  {line.numero ? ` n° ${line.numero}` : ""}
                </Badge>
              ) : null}
              {line.status !== "A_TRAITER" ? <Badge variant={line.status === "IGNORE" ? "muted" : "success"}>{STATEMENT_STATUS_LABELS[line.status]}</Badge> : null}
              {line.twinDate ? <Badge variant="destructive">Doublon probable : même montant et libellé le {formatDate(line.twinDate)}</Badge> : null}
              {line.payroll ? <Badge variant="warning">Ligne de paie probable</Badge> : null}
              {line.transfer ? (
                <Link href="/releve/rapprochement" className="inline-flex">
                  <Badge variant="accent">
                    Envoi de virements « {line.transfer.ref} » ({line.transfer.produit}, {line.transfer.nb} virements) → détailler
                  </Badge>
                </Link>
              ) : null}
            </div>
          </div>
          <div className={cn("shrink-0 text-right font-semibold tabular-nums md:w-40", line.sens === "DEBIT" ? "text-destructive" : "text-success")}>
            {line.sens === "DEBIT" ? "− " : "+ "}
            {formatDA(line.montant)}
          </div>
          {canEdit ? (
            <div className="shrink-0 md:w-80">
              <LineActions line={line} categories={categories} />
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
