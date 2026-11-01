import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { DonutChart } from "@/components/common/donut-chart";
import { PageHeader } from "@/components/common/page-header";
import { StateMessage } from "@/components/common/state-message";
import { TabsNav } from "@/components/common/tabs-nav";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ALERT_LEVELS, getAlerts, type AlertGroup, type AlertLevel } from "@/features/invoices/services/alert-service";
import { partnerKey } from "@/features/partners/services/partner-service";
import { formatDA, formatDate } from "@/utils/format";

export const metadata: Metadata = { title: "Alertes impayés" };

const LEVEL: Record<AlertLevel, { label: string; variant: "destructive" | "warning" | "muted" }> = {
  critique: { label: "Critique", variant: "destructive" },
  retard: { label: "En retard", variant: "warning" },
  relance: { label: "À relancer", variant: "muted" },
};

function Group({ group, sens }: Readonly<{ group: AlertGroup; sens: "CREDIT" | "DEBIT" }>): React.JSX.Element {
  return (
    <details className="rounded-lg border bg-card">
      <summary className="flex cursor-pointer flex-wrap items-center gap-3 px-4 py-3">
        <Badge variant={LEVEL[group.level].variant}>{LEVEL[group.level].label}</Badge>
        <span className="min-w-0 flex-1 font-medium">{group.tiers}</span>
        <span className="text-sm text-muted-foreground">
          {group.count} facture(s) · la plus ancienne : {group.oldest} j
        </span>
        <span className="font-semibold tabular-nums">{formatDA(group.total)}</span>
      </summary>
      <div className="border-t px-4 py-3">
        <ul className="divide-y text-sm">
          {group.items.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center gap-3 py-2">
              <Link href={`/factures/${item.id}`} className="font-medium hover:underline">
                {item.numero || "sans n°"}
              </Link>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">{item.libelle}</span>
              <span className="tabular-nums text-muted-foreground">
                {formatDate(item.dateFacture)} · {item.jours} j
              </span>
              <Badge variant={LEVEL[item.level].variant}>{LEVEL[item.level].label}</Badge>
              <span className="w-32 text-right tabular-nums">{formatDA(item.reste)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex flex-wrap gap-3 text-sm">
          {sens === "CREDIT" && group.categorie ? (
            <Link href={`/partenaires/${encodeURIComponent(partnerKey(group.categorie))}`} className="font-medium text-primary hover:underline">
              Relancer ce client (fiche partenaire)
            </Link>
          ) : null}
          {sens === "DEBIT" ? (
            <Link href="/demandes" className="font-medium text-primary hover:underline">
              Préparer la demande de paiement
            </Link>
          ) : null}
          <Link href={`/factures?sens=${sens}&status=EN_ATTENTE&q=${encodeURIComponent(group.tiers)}`} className="text-muted-foreground hover:underline">
            Voir dans les factures
          </Link>
        </div>
      </div>
    </details>
  );
}

/** Alertes automatiques : factures clients et fournisseurs impayées depuis 30, 60 et 90 jours. */
export default async function AlertsPage({ searchParams }: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>): Promise<React.JSX.Element> {
  const user = await requireUser();
  const raw = await searchParams;
  const result = await getAlerts(user);
  if (!result.success) return <StateMessage kind={result.code === "FORBIDDEN" ? "forbidden" : "error"} title="Alertes indisponibles" message={result.error} />;
  const data = result.data;
  const asked = Array.isArray(raw.onglet) ? raw.onglet[0] : raw.onglet;
  const tab = asked === "fournisseurs" || (asked !== "clients" && data.clients.length === 0 && data.fournisseurs.length > 0) ? "fournisseurs" : "clients";
  const groups = tab === "clients" ? data.clients : data.fournisseurs;
  const sens = tab === "clients" ? "CREDIT" : "DEBIT";
  const byLevel = ALERT_LEVELS.map((level) => {
    const items = groups.flatMap((group) => group.items).filter((item) => item.level === level.key);
    return { label: `${level.label} (≥ ${level.min} j)`, amount: items.reduce((s, i) => s + i.reste, 0), count: items.length };
  });
  return (
    <>
      <PageHeader
        title="Alertes impayés"
        description={`Calculées automatiquement à chaque consultation, au ${formatDate(data.asOf)} : toute facture en attente depuis 30 jours ou plus est signalée (60 jours : en retard, 90 jours : critique).`}
      />
      <TabsNav
        tabs={[
          { href: "/alertes?onglet=clients", label: "Clients à relancer", active: tab === "clients", count: data.counts.clients },
          { href: "/alertes?onglet=fournisseurs", label: "Fournisseurs à payer", active: tab === "fournisseurs", count: data.counts.fournisseurs },
        ]}
      />
      {groups.length === 0 ? (
        <StateMessage kind="empty" title="Aucune alerte" message="Aucune facture en attente depuis 30 jours ou plus." />
      ) : (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <Card>
            <CardHeader>
              <CardTitle>{tab === "clients" ? "Montants à encaisser en alerte" : "Montants à payer en alerte"}</CardTitle>
              <CardDescription>Par niveau d&apos;ancienneté</CardDescription>
            </CardHeader>
            <CardContent>
              <DonutChart slices={byLevel} centerLabel="En alerte" />
            </CardContent>
          </Card>
          <div className="flex flex-col gap-2">
            {groups.map((group) => (
              <Group key={group.tiers} group={group} sens={sens} />
            ))}
          </div>
        </div>
      )}
    </>
  );
}
