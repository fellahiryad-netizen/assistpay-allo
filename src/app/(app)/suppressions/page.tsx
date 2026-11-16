import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/common/page-header";
import { StateMessage } from "@/components/common/state-message";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DeletionDecision } from "@/features/invoices/components/deletion-decision";
import { listDeletionHistory, listDeletions } from "@/features/invoices/services/deletion-service";
import { formatDA, formatDateTime } from "@/utils/format";

export const metadata: Metadata = { title: "Suppressions à valider" };

/** Demandes de suppression de factures : l'administrateur valide ou refuse. */
export default async function DeletionsPage(): Promise<React.JSX.Element> {
  const user = await requireUser();
  const readOnly = !user.isAdmin;
  const result = readOnly ? await listDeletionHistory(user) : await listDeletions(user);
  if (!result.success) return <StateMessage kind={result.code === "FORBIDDEN" ? "forbidden" : "error"} title="Suppressions indisponibles" message={result.error} />;
  const pending = result.data.filter((item) => item.status === "attente");
  const done = result.data.filter((item) => item.status !== "attente").slice(0, readOnly ? 300 : 50);
  return (
    <>
      <PageHeader
        title={readOnly ? "Historique des suppressions" : "Suppressions à valider"}
        description={readOnly ? "Consultation des demandes de suppression de factures et de la décision de l'administrateur. Les suppressions faites directement par l'administrateur figurent au journal des actions." : "Une facture n'est supprimée qu'après votre validation. Le refus la laisse intacte ; chaque décision est inscrite au journal d'administration."}
      />
      {pending.length === 0 ? (
        <StateMessage kind="empty" title={readOnly ? "Aucune demande en attente de décision" : "Aucune demande en attente"} />
      ) : (
        <div className="mb-6 overflow-x-auto rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Facture</TableHead>
                <TableHead className="text-right">Montant</TableHead>
                <TableHead>Demandée par</TableHead>
                <TableHead>Motif</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {pending.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="max-w-72">
                    <Link href={item.kind === "facture" ? `/factures/${item.targetId}` : `/facturation/${item.targetId}`} className="font-medium hover:underline">
                      {item.label}
                    </Link>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right tabular-nums">{formatDA(item.amount)}</TableCell>
                  <TableCell>
                    {item.by}
                    <span className="block text-xs text-muted-foreground">{formatDateTime(item.at)}</span>
                  </TableCell>
                  <TableCell className="max-w-64 text-sm text-muted-foreground">{item.motif || "—"}</TableCell>
                  <TableCell className="text-right">
                    {readOnly ? <Badge variant="warning">En attente de l'administrateur</Badge> : <DeletionDecision id={item.id} />}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {done.length ? (
        <>
          <h2 className="mb-2 text-lg font-semibold">{readOnly ? "Historique des décisions" : "Décisions récentes"}</h2>
          <ul className="divide-y rounded-lg border bg-card text-sm">
            {done.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center gap-3 px-4 py-2">
                <Badge variant={item.status === "validee" ? "success" : "muted"}>{item.status === "validee" ? "Supprimée" : "Refusée"}</Badge>
                <span className="min-w-0 flex-1 truncate">
                  {item.label} · {formatDA(item.amount)}
                  {item.motif ? <span className="block truncate text-xs text-muted-foreground">Motif : {item.motif}</span> : null}
                </span>
                <span className="text-muted-foreground">
                  demandée par {item.by} · {item.status === "validee" ? "validée" : "refusée"} par {item.decidedBy} le {item.decidedAt ? formatDateTime(item.decidedAt) : ""}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </>
  );
}
