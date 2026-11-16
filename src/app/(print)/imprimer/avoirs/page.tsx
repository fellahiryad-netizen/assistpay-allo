import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { PrintToolbar } from "@/components/common/print-toolbar";
import { StateMessage } from "@/components/common/state-message";
import { AvoirDocument } from "@/features/avoirs/components/avoir-document";
import { getAvoirForPrint } from "@/features/avoirs/services/avoir-service";

export const metadata: Metadata = { title: "Impression d'un avoir" };

/** Impression d'une facture d'avoir (A4, noir et blanc, sur papier à en-tête). */
export default async function PrintAvoirPage({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>): Promise<React.JSX.Element> {
  const user = await requireUser();
  const raw = await searchParams;
  const id = typeof raw.id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(raw.id) ? raw.id : "";
  const result = id ? await getAvoirForPrint(user, id) : null;
  if (!result?.success) return <StateMessage kind="empty" title="Avoir introuvable" className="mx-auto max-w-xl" />;
  return (
    <>
      <PrintToolbar title={`Avoir ${result.data.num}`} autoPrint={false} />
      <AvoirDocument data={result.data} />
    </>
  );
}
