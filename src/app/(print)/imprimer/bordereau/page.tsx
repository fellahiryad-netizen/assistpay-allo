import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { PrintToolbar } from "@/components/common/print-toolbar";
import { StateMessage } from "@/components/common/state-message";
import { BordereauSheet } from "@/features/courrier/components/bordereau-sheet";
import { numeroSchema } from "@/features/courrier/schemas";
import { getEnvoi } from "@/features/courrier/services/envoi-service";

export const metadata: Metadata = { title: "Bordereau d'envoi" };

/** Bordereau d'envoi enregistré (A4 portrait, papier à en-tête) : `no` = numéro BE-AAAA-NNN, `copie=1` ajoute la mention DUPLICATA. Un bordereau non enregistré ne s'imprime pas. */
export default async function PrintBordereauPage({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>): Promise<React.JSX.Element> {
  const user = await requireUser();
  const raw = await searchParams;
  const parsed = numeroSchema.safeParse(Array.isArray(raw.no) ? raw.no[0] : raw.no);
  if (!parsed.success) {
    return <StateMessage kind="error" title="Bordereau introuvable" message="Seul un bordereau enregistré peut être imprimé. Établissez-le depuis « Adresses courrier »." className="mx-auto max-w-xl" />;
  }
  const result = await getEnvoi(user, parsed.data);
  if (!result.success) return <StateMessage kind={result.code === "FORBIDDEN" ? "forbidden" : "error"} title="Bordereau indisponible" message={result.error} className="mx-auto max-w-xl" />;
  const copie = (Array.isArray(raw.copie) ? raw.copie[0] : raw.copie) === "1";
  const sansCachet = (Array.isArray(raw.cachet) ? raw.cachet[0] : raw.cachet) === "0";
  return (
    <>
      <PrintToolbar title={`Bordereau ${result.data.numero}${copie ? " (duplicata)" : ""} — A4 portrait, à imprimer sur le papier à en-tête`} />
      <div className="overflow-x-auto">
        <BordereauSheet envoi={result.data} duplicata={copie} cachet={!sansCachet} />
      </div>
    </>
  );
}
