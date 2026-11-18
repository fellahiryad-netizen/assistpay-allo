import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { getAvoirTrackingForInvoice } from "@/features/avoirs/services/avoir-service";
import { formatDA, formatDate } from "@/utils/format";

/**
 * Avoirs rattachés à une facture (fiche facture) : liste, total des avoirs et net restant.
 * N'affiche rien s'il n'y a pas d'avoir ; lecture seule, le suivi des créances n'est pas modifié.
 */
export async function AvoirsOfInvoice({ invoiceLegacyId }: Readonly<{ invoiceLegacyId: string }>): Promise<React.JSX.Element | null> {
  const user = await requireUser();
  const result = await getAvoirTrackingForInvoice(user, invoiceLegacyId);
  if (!result.success || !result.data) return null;
  const tracking = result.data;
  return (
    <section aria-label="Avoirs rattachés" className="rounded-md border p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Avoirs rattachés à la facture {tracking.origineNum}</h3>
        <Link href={`/avoirs?origine=${tracking.origineId}`} className="text-sm font-medium underline">
          Voir dans les avoirs
        </Link>
      </div>
      <ul className="mb-2 flex flex-col gap-1 text-sm">
        {tracking.avoirs.map((avoir) => (
          <li key={avoir.id} className={`flex flex-wrap justify-between gap-2 ${avoir.annule ? "opacity-60" : ""}`}>
            <span>
              <Link href={`/imprimer/avoirs?id=${avoir.id}`} target="_blank" className="font-medium underline">
                {avoir.num}
              </Link>{" "}
              · {formatDate(avoir.date)} · {avoir.motif}
              {avoir.annule ? <Badge variant="muted" className="ml-2">annulé</Badge> : null}
            </span>
            <span className="tabular-nums">−{formatDA(avoir.ttc)}</span>
          </li>
        ))}
      </ul>
      <dl className="grid grid-cols-3 gap-2 border-t pt-2 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">Facture TTC</dt>
          <dd className="tabular-nums">{formatDA(tracking.origineTtc)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Total des avoirs</dt>
          <dd className="tabular-nums">−{formatDA(tracking.totalAvoirs)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Net restant</dt>
          <dd className="font-semibold tabular-nums">{formatDA(tracking.netRestant)}</dd>
        </div>
      </dl>
      <p className="mt-2 text-xs text-muted-foreground">Information de suivi : le montant de la facture et les créances ne sont pas modifiés par les avoirs.</p>
    </section>
  );
}
