import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { PrintToolbar } from "@/components/common/print-toolbar";
import { StateMessage } from "@/components/common/state-message";
import { BordereauSheet } from "@/features/courrier/components/bordereau-sheet";
import { bordereauLinesOf, bordereauQuerySchema } from "@/features/courrier/schemas";
import { getAddressBook } from "@/features/courrier/services/courrier-service";

export const metadata: Metadata = { title: "Bordereau d'envoi" };

/** Bordereau d'envoi (A4 portrait, papier à en-tête) pour le prestataire de courrier ; tout vient de l'adresse de la page, validée. */
export default async function PrintBordereauPage({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>): Promise<React.JSX.Element> {
  const user = await requireUser();
  const raw = await searchParams;
  const parsed = bordereauQuerySchema.safeParse({ date: raw.date, cachet: raw.cachet, des: raw.des, qnt: raw.qnt, dst: raw.dst, obs: raw.obs });
  if (!parsed.success) {
    return <StateMessage kind="error" title="Bordereau impossible" message={parsed.error.issues[0]?.message ?? "Paramètres invalides."} className="mx-auto max-w-xl" />;
  }
  const result = await getAddressBook(user);
  if (!result.success) return <StateMessage kind={result.code === "FORBIDDEN" ? "forbidden" : "error"} title="Bordereau indisponible" message={result.error} className="mx-auto max-w-xl" />;
  const ramasseur = result.data.emsContacts.find((contact) => contact.role === "RAMASSEUR")?.nom ?? "";
  return (
    <>
      <PrintToolbar title="Bordereau d'envoi (A4 portrait, à imprimer sur le papier à en-tête)" />
      <div className="overflow-x-auto">
        <BordereauSheet date={parsed.data.date} lines={bordereauLinesOf(parsed.data)} cachet={parsed.data.cachet} ramasseur={ramasseur} />
      </div>
    </>
  );
}
