import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/common/page-header";
import { StateMessage } from "@/components/common/state-message";
import { can } from "@/features/access/services/access-rules";
import { BillingEditor } from "@/features/billing/components/billing-editor";
import { prepareBillingSchema } from "@/features/billing/schemas";
import { prepareDraft } from "@/features/billing/services/billing-service";

export const metadata: Metadata = { title: "Nouvelle facture" };

/** Nouvelle facture (modèle, duplication ou production CAAR). */
export default async function NewBillingPage({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>): Promise<React.JSX.Element> {
  const user = await requireUser();
  const raw = await searchParams;
  const one = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value) || undefined;
  const scope = one(raw.portee) === "bdg" ? "bdg" : one(raw.portee) === "gam" ? "gam" : "all";
  const parsed = prepareBillingSchema.safeParse({
    preset: one(raw.modele) ?? (scope === "bdg" ? "c_bdg" : scope === "gam" ? "g_bdgab_c" : "g_conv"),
    client: one(raw.client),
    duplicateOf: one(raw.dupliquer),
    caarId: one(raw.caar),
  });
  if (!parsed.success) return <StateMessage kind="error" title="Paramètres invalides" />;
  const result = await prepareDraft(user, parsed.data);
  if (!result.success) return <StateMessage kind={result.code === "FORBIDDEN" ? "forbidden" : "error"} title="Facture impossible à préparer" message={result.error} />;
  return (
    <>
      <PageHeader title={scope === "bdg" ? "Factures BDG CAAT et TRUST" : scope === "gam" ? "Factures BDG GAM" : "Nouvelle facture"} description="Aperçu en direct ; à l'enregistrement, la facture est ajoutée aux factures clients en attente." />
      <BillingEditor initial={result.data} canEdit={can(user, "FACT", "EDIT")} scope={scope} />
    </>
  );
}
