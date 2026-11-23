import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/common/page-header";
import { StateMessage } from "@/components/common/state-message";
import { CourrierApp } from "@/features/courrier/components/courrier-app";
import { EmsCard } from "@/features/courrier/components/ems-card";
import { getAddressBook } from "@/features/courrier/services/courrier-service";

export const metadata: Metadata = { title: "Adresses courrier" };

/** Adresses courrier : succursales CAAR et CAAT, étiquettes d'enveloppe et contacts du prestataire de courrier (EMS). */
export default async function MailAddressesPage(): Promise<React.JSX.Element> {
  const user = await requireUser();
  const result = await getAddressBook(user);
  if (!result.success) return <StateMessage kind={result.code === "FORBIDDEN" ? "forbidden" : "error"} title="Adresses courrier indisponibles" message={result.error} />;
  const book = result.data;
  return (
    <>
      <PageHeader title="Adresses courrier" description="Où envoyer les originaux des factures CAAR et CAAT, et qui joindre chez EMS pour le ramassage." />
      <EmsCard societe={book.emsSociete} contacts={book.emsContacts} />
      <CourrierApp branches={book.branches} emsSociete={book.emsSociete} emsContacts={book.emsContacts} canEdit={book.canEdit} persisted={book.persisted} />
    </>
  );
}
