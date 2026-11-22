import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ReceivablesSummary } from "@/features/receivables/types";
import { formatDA } from "@/utils/format";

/** Points d'attention calculés : factures de plus de 90 jours par compagnie, factures sans date. */
export function AttentionPoints({ summary }: Readonly<{ summary: ReceivablesSummary }>): React.JSX.Element {
  const { over90, undated } = summary.attention;
  const over90Count = over90.reduce((sum, item) => sum + item.count, 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="size-4" aria-hidden />
          Points d&apos;attention
        </CardTitle>
        <CardDescription>Calculés sur les factures affichées ci-dessus</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5 md:grid-cols-2">
        <section>
          <h3 className="mb-2 text-sm font-medium">Plus de 90 jours : {over90Count} facture(s)</h3>
          {over90.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucune facture de plus de 90 jours.</p>
          ) : (
            <ul className="divide-y text-sm">
              {over90.map((item) => (
                <li key={item.company} className="flex items-center justify-between gap-3 py-1.5">
                  <span>
                    {item.company} <span className="text-xs text-muted-foreground">({item.count})</span>
                  </span>
                  <span className="tabular-nums">{formatDA(item.amount)}</span>
                </li>
              ))}
            </ul>
          )}
          <Link href="/alertes" className="mt-2 inline-block text-xs font-medium text-primary hover:underline">
            Voir les alertes impayés
          </Link>
        </section>
        <section>
          <h3 className="mb-2 text-sm font-medium">Sans date de facture ni d&apos;opération : {summary.undated.count} facture(s)</h3>
          {undated.length === 0 ? (
            <p className="text-sm text-muted-foreground">Toutes les factures sont datées.</p>
          ) : (
            <>
              <ul className="divide-y text-sm">
                {undated.map((item) => (
                  <li key={item.company} className="flex items-center justify-between gap-3 py-1.5">
                    <span>
                      {item.company} <span className="text-xs text-muted-foreground">({item.count})</span>
                    </span>
                    <span className="tabular-nums">{formatDA(item.amount)}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-muted-foreground">Leur ancienneté est inconnue : elles sont exclues de l&apos;ancienneté moyenne et classées « Sans date ».</p>
            </>
          )}
        </section>
      </CardContent>
    </Card>
  );
}
