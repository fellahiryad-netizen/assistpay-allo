import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { Notice } from "@/components/common/notice";
import { PageHeader } from "@/components/common/page-header";
import { StateMessage } from "@/components/common/state-message";
import { CourrierApp } from "@/features/courrier/components/courrier-app";
import { CourrierTabs } from "@/features/courrier/components/courrier-tabs";
import { EmsCard } from "@/features/courrier/components/ems-card";
import { lastSentByBranch, overdueEnvois } from "@/features/courrier/lib/envois";
import { getAddressBook } from "@/features/courrier/services/courrier-service";
import { listEnvois } from "@/features/courrier/services/envoi-service";
import { todayIso } from "@/utils/dates";

export const metadata: Metadata = { title: "Adresses courrier" };

/** Adresses courrier : succursales CAAR et CAAT, étiquettes d'enveloppe, bordereaux d'envoi et contacts du prestataire de courrier (EMS). */
export default async function MailAddressesPage(): Promise<React.JSX.Element> {
  const user = await requireUser();
  const [result, envois] = await Promise.all([getAddressBook(user), listEnvois(user)]);
  if (!result.success) return <StateMessage kind={result.code === "FORBIDDEN" ? "forbidden" : "error"} title="Adresses courrier indisponibles" message={result.error} />;
  const book = result.data;
  const history = envois.success ? envois.data.envois : [];
  const late = overdueEnvois(history, todayIso()).length;
  return (
    <>
      <PageHeader title="Adresses courrier" description="Où envoyer les originaux des factures CAAR et CAAT, et qui joindre chez EMS pour le ramassage." />
      <CourrierTabs current="adresses" />
      {late > 0 ? (
        <Notice tone="warning" className="mb-4">
          {late} bordereau{late > 1 ? "x" : ""} sans date de ramassage depuis plus de 2 jours.{" "}
          <Link href="/adresses-courrier/historique?ramasse=non&statut=ETABLI" className="font-medium underline">
            Renseigner les dates
          </Link>
        </Notice>
      ) : null}
      {envois.success ? null : (
        <Notice tone="error" className="mb-4">
          {envois.error}
        </Notice>
      )}
      <EmsCard societe={book.emsSociete} contacts={book.emsContacts} />
      <CourrierApp branches={book.branches} emsSociete={book.emsSociete} emsContacts={book.emsContacts} canEdit={book.canEdit} persisted={book.persisted} lastSent={lastSentByBranch(history)} />
    </>
  );
}
