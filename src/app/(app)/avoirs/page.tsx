import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/common/page-header";
import { StateMessage } from "@/components/common/state-message";
import { can } from "@/features/access/services/access-rules";
import { AvoirForm } from "@/features/avoirs/components/avoir-form";
import { AvoirList } from "@/features/avoirs/components/avoir-list";
import { listAvoirable, listAvoirs } from "@/features/avoirs/services/avoir-service";
import { CLIENT_LABELS } from "@/features/billing/config";

export const metadata: Metadata = { title: "Factures d'avoir" };

/** Factures d'avoir : corriger une facture déjà établie (et éventuellement encaissée) sans la modifier. */
export default async function AvoirsPage({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>): Promise<React.JSX.Element> {
  const user = await requireUser();
  const raw = await searchParams;
  const origine = typeof raw.origine === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(raw.origine) ? raw.origine : "";
  const [avoirable, avoirs] = await Promise.all([listAvoirable(user), listAvoirs(user)]);
  if (!avoirable.success) return <StateMessage kind={avoirable.code === "FORBIDDEN" ? "forbidden" : "error"} title="Factures d'avoir indisponibles" message={avoirable.error} />;
  if (!avoirs.success) return <StateMessage kind="error" title="Factures d'avoir indisponibles" message={avoirs.error} />;
  const canEdit = can(user, "FACT", "EDIT") && can(user, "A_RECT", "EDIT");
  const clients = Object.entries(CLIENT_LABELS).map(([code, label]) => ({ code, label }));
  return (
    <>
      <PageHeader
        title="Factures d'avoir"
        description="Pour corriger une facture déjà établie ou encaissée : choisissez la facture d'origine (recherche par n°, compagnie ou montant), saisissez le montant HT ou TTC et le motif. L'avoir est numéroté AV, la facture d'origine n'est pas modifiée et le suivi des créances non plus."
      />
      {canEdit ? <AvoirForm clients={clients} invoices={avoirable.data} initialOriginId={origine} /> : <StateMessage kind="forbidden" title="Création d'avoir non autorisée" message="Il faut le droit de rectifier une facture établie." />}
      <AvoirList items={avoirs.data} canEdit={canEdit} initialOrigineId={origine} />
    </>
  );
}
