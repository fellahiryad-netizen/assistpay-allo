import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { PrintToolbar } from "@/components/common/print-toolbar";
import { StateMessage } from "@/components/common/state-message";
import { EnvelopeSheets } from "@/features/courrier/components/envelope-label";
import { pickBranches } from "@/features/courrier/lib/address-book";
import { envelopeQuerySchema } from "@/features/courrier/schemas";
import { getAddressBook } from "@/features/courrier/services/courrier-service";

export const metadata: Metadata = { title: "Étiquette d'enveloppe" };

/** Étiquettes d'enveloppe (A4 paysage, une par page) pour les succursales demandées dans `ids`. */
export default async function PrintEnvelopePage({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>): Promise<React.JSX.Element> {
  const user = await requireUser();
  const raw = await searchParams;
  const ids = Array.isArray(raw.ids) ? raw.ids.join(",") : (raw.ids ?? "");
  const parsed = envelopeQuerySchema.safeParse({ ids });
  if (!parsed.success) return <StateMessage kind="error" title="Aucune succursale choisie" message="Choisissez une ou plusieurs succursales dans la page « Adresses courrier »." className="mx-auto max-w-xl" />;
  const result = await getAddressBook(user);
  if (!result.success) return <StateMessage kind={result.code === "FORBIDDEN" ? "forbidden" : "error"} title="Étiquette indisponible" message={result.error} className="mx-auto max-w-xl" />;
  const branches = pickBranches(result.data.branches, parsed.data.ids);
  if (branches.length === 0) return <StateMessage kind="empty" title="Succursale introuvable" message="Cette fiche a peut-être été supprimée. Retournez à la page « Adresses courrier »." className="mx-auto max-w-xl" />;
  return (
    <>
      <PrintToolbar title={branches.length > 1 ? `${branches.length} étiquettes d'enveloppe (une par page, A4 paysage)` : "Étiquette d'enveloppe (A4 paysage)"} />
      <div className="overflow-x-auto">
        <EnvelopeSheets branches={branches} />
      </div>
    </>
  );
}
