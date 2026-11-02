import type { Metadata } from "next";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { PrintToolbar } from "@/components/common/print-toolbar";
import { StateMessage } from "@/components/common/state-message";
import Link from "next/link";
import { InvoiceDocument, type LetterheadMode } from "@/features/billing/components/invoice-document";
import { getIssued } from "@/features/billing/services/billing-service";
import type { BillingDraft } from "@/features/billing/types";

export const metadata: Metadata = { title: "Impression des factures" };

const idsSchema = z.string().max(4000).transform((value) => value.split(",").map((id) => id.trim()).filter((id) => /^[A-Za-z0-9_-]{1,64}$/.test(id)).slice(0, 50));

/** Impression d'une ou plusieurs factures (format A4). */
export default async function PrintBillingPage({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>): Promise<React.JSX.Element> {
  const user = await requireUser();
  const raw = await searchParams;
  const ids = idsSchema.parse(Array.isArray(raw.ids) ? raw.ids.join(",") : raw.ids ?? "");
  const entete: LetterheadMode = raw.entete === "charte" ? "charte" : "papier";
  const drafts: Array<{ id: string; draft: BillingDraft }> = [];
  for (const id of ids) {
    const result = await getIssued(user, id);
    if (result.success) drafts.push({ id, draft: result.data.draft });
  }
  if (drafts.length === 0) return <StateMessage kind="empty" title="Aucune facture à imprimer" className="mx-auto max-w-xl" />;
  return (
    <>
      <div className="no-print mx-auto mb-3 flex max-w-3xl flex-wrap items-center gap-2 px-4 text-sm">
        <span className="text-muted-foreground">Présentation :</span>
        {([["papier", "Sur papier à en-tête (marges réservées)"], ["charte", "Avec la charte (logo et pied de page)"]] as const).map(([mode, label]) => (
          <Link
            key={mode}
            href={`/imprimer/factures?ids=${ids.join(",")}&entete=${mode}`}
            className={`rounded-md border px-3 py-1.5 ${entete === mode ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted"}`}
          >
            {label}
          </Link>
        ))}
      </div>
      <PrintToolbar title={`${drafts.length} facture(s)`} autoPrint={false} />
      <div className="flex flex-col gap-6 print:gap-0">
        {drafts.map((entry) => (
          <InvoiceDocument key={entry.id} draft={entry.draft} entete={entete} />
        ))}
      </div>
    </>
  );
}
