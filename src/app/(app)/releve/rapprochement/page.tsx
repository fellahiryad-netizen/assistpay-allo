import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/common/page-header";
import { StateMessage } from "@/components/common/state-message";
import { can } from "@/features/access/services/access-rules";
import { DoubleEntryCard } from "@/features/statement/components/double-entry-card";
import { TransferReconciliationCard } from "@/features/statement/components/transfer-reconciliation-card";
import { listDoubleEntries, listTransferReconciliations } from "@/features/statement/services/double-entry-service";

export const metadata: Metadata = { title: "Double emploi et rapprochement" };

/** Double emploi et rapprochement des virements. */
export default async function ReconciliationPage(): Promise<React.JSX.Element> {
  const user = await requireUser();
  if (!can(user, "RELEVE") && !can(user, "FFOUR")) {
    return <StateMessage kind="forbidden" title="Accès refusé" message="Cette page demande l'accès au relevé bancaire ou aux factures fournisseurs." />;
  }
  const [transfers, doubles] = await Promise.all([
    can(user, "RELEVE") ? listTransferReconciliations(user) : Promise.resolve(null),
    can(user, "FFOUR") ? listDoubleEntries(user) : Promise.resolve(null),
  ]);
  return (
    <>
      <PageHeader
        title="Double emploi et rapprochement des virements"
        description="Le relevé ne montre qu'un montant global par envoi de virements ; le fichier remis à la banque donne le détail par prestataire. Chaque débit global est rapproché de ce détail, et chaque double emploi au Débit vous est présenté pour validation."
      />
      {transfers ? (
        <section className="mb-8 flex flex-col gap-3">
          <h2 className="text-lg font-semibold">1. Débits globaux du relevé à détailler ({transfers.success ? transfers.data.length : 0})</h2>
          {!transfers.success ? (
            <StateMessage kind="error" title="Calcul impossible" message={transfers.error} />
          ) : transfers.data.length === 0 ? (
            <StateMessage kind="empty" title="Aucun débit global en attente" message="Tous les envois de virements reconnus sont rapprochés." />
          ) : (
            transfers.data.map((item) => <TransferReconciliationCard key={item.lineId} item={item} canEdit={can(user, "RELEVE", "EDIT") && can(user, "FFOUR", "EDIT")} />)
          )}
        </section>
      ) : null}
      {doubles ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">2. Doubles emplois détectés au Débit ({doubles.success ? doubles.data.length : 0})</h2>
          {!doubles.success ? (
            <StateMessage kind="error" title="Contrôle impossible" message={doubles.error} />
          ) : doubles.data.length === 0 ? (
            <StateMessage kind="empty" title="Aucun double emploi détecté" message="Contrôle effectué sur le Débit depuis le 01/08/2026." />
          ) : (
            doubles.data.map((item) => (
              <DoubleEntryCard key={item.kind === "pair" ? `${item.a.id}-${item.b.id}` : item.global.id} item={item} canEdit={can(user, "FFOUR", "EDIT")} />
            ))
          )}
        </section>
      ) : null}
    </>
  );
}
