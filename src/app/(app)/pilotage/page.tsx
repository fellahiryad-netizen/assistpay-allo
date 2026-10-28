import type { Metadata } from "next";
import Link from "next/link";
import { Download } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/common/page-header";
import { StateMessage } from "@/components/common/state-message";
import { TabsNav } from "@/components/common/tabs-nav";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can } from "@/features/access/services/access-rules";
import { ClosingList } from "@/features/pilot/components/closing-list";
import { activityMargins, agingBalance, closingChecklist, treasuryForecast } from "@/features/pilot/services/pilot-service";
import { AGING_BUCKETS } from "@/features/pilot/types";
import { ControlSettingsForm } from "@/features/settings/components/control-settings-form";
import { getControlSettings } from "@/features/settings/services/settings-service";
import { cn } from "@/utils/cn";
import { MONTHS_FR, todayIso } from "@/utils/dates";
import { formatCompact, formatDA } from "@/utils/format";

export const metadata: Metadata = { title: "Pilotage" };

const TABS = [
  ["cloture", "Clôture du mois"],
  ["creances", "Balance âgée et délais"],
  ["tresorerie", "Prévision de trésorerie"],
  ["rentabilite", "Rentabilité par activité"],
  ["parametres", "Paramètres et sauvegarde"],
] as const;
type Tab = (typeof TABS)[number][0];

function recentMonths(today: string, count: number): string[] {
  const base = Number(today.slice(0, 4)) * 12 + Number(today.slice(5, 7)) - 1;
  return Array.from({ length: count }, (_, index) => {
    const value = base - index;
    return `${Math.floor(value / 12)}-${String((value % 12) + 1).padStart(2, "0")}`;
  });
}

/** Pilotage : clôture mensuelle, balance âgée, trésorerie, rentabilité, paramètres et sauvegarde. */
export default async function PilotPage({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>): Promise<React.JSX.Element> {
  const user = await requireUser();
  if (!can(user, "PILOT")) return <StateMessage kind="forbidden" title="Pilotage" message="Vous n'avez pas accès au pilotage." />;
  const raw = await searchParams;
  const one = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value) || undefined;
  const tabParam = one(raw.onglet);
  const tab: Tab = TABS.some(([key]) => key === tabParam) ? (tabParam as Tab) : "cloture";
  const today = todayIso();
  const months = recentMonths(today, 14);
  const monthParam = one(raw.mois);
  const ym = monthParam && months.includes(monthParam) ? monthParam : (months[1] ?? today.slice(0, 7));
  const year = Number(one(raw.annee)) || Number(today.slice(0, 4));
  return (
    <>
      <PageHeader title="Pilotage" description="Vue de direction : ce qu'il reste à faire pour clôturer le mois, l'âge des créances et les délais réels de paiement, la trésorerie attendue et la marge par activité." />
      <TabsNav tabs={TABS.map(([key, label]) => ({ href: `/pilotage?onglet=${key}`, label, active: tab === key }))} />
      {tab === "cloture" ? <Closing ym={ym} months={months} user={user} /> : null}
      {tab === "creances" ? <Aging user={user} /> : null}
      {tab === "tresorerie" ? <Treasury user={user} /> : null}
      {tab === "rentabilite" ? <Margins user={user} year={year} currentYear={Number(today.slice(0, 4))} /> : null}
      {tab === "parametres" ? <Settings isAdmin={user.isAdmin} /> : null}
    </>
  );
}

type User = Awaited<ReturnType<typeof requireUser>>;
const monthLabel = (ym: string): string => `${MONTHS_FR[Number(ym.slice(5)) - 1] ?? ""} ${ym.slice(0, 4)}`;

async function Closing({ ym, months, user }: Readonly<{ ym: string; months: string[]; user: User }>): Promise<React.JSX.Element> {
  const result = await closingChecklist(user, ym);
  if (!result.success) return <StateMessage kind="error" title="Clôture indisponible" message={result.error} />;
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-1">
        <span className="mr-2 text-sm text-muted-foreground">Mois à clôturer :</span>
        {months.slice(0, 6).map((month) => (
          <Link key={month} href={`/pilotage?onglet=cloture&mois=${month}`} className={buttonVariants({ size: "sm", variant: month === ym ? "default" : "outline" })}>
            {monthLabel(month)}
          </Link>
        ))}
      </div>
      <ClosingList items={result.data} />
    </>
  );
}

async function Aging({ user }: Readonly<{ user: User }>): Promise<React.JSX.Element> {
  const result = await agingBalance(user);
  if (!result.success) return <StateMessage kind="error" title="Balance âgée indisponible" message={result.error} />;
  const { rows, total } = result.data;
  return (
    <>
      <p className="mb-3 text-sm text-muted-foreground">Reste à encaisser par partenaire selon l&apos;ancienneté de la facture (date de dépôt). Le délai réel de paiement est la moyenne pondérée, sur les 13 derniers mois, entre la date de facture et la date d&apos;encaissement.</p>
      <div className="overflow-x-auto rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Partenaire</TableHead>
              <TableHead className="text-right">Factures</TableHead>
              {AGING_BUCKETS.map(([label]) => (
                <TableHead key={label} className="text-right">
                  {label}
                </TableHead>
              ))}
              <TableHead className="text-right">Sans date</TableHead>
              <TableHead className="text-right">Total à encaisser</TableHead>
              <TableHead className="text-right">Délai réel</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.partner}>
                <TableCell className="font-medium">
                  <Link href={`/partenaires/${encodeURIComponent(row.partner)}`} className="hover:underline">
                    {row.partner}
                  </Link>
                </TableCell>
                <TableCell className="text-right tabular-nums">{row.count}</TableCell>
                {row.buckets.map((value, index) => (
                  <TableCell key={index} className={cn("text-right tabular-nums", value && index >= 3 && "text-destructive")}>
                    {value ? formatDA(value) : "·"}
                  </TableCell>
                ))}
                <TableCell className="text-right tabular-nums">{row.undated ? formatDA(row.undated) : "·"}</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{formatDA(row.total)}</TableCell>
                <TableCell className="text-right tabular-nums">{row.dso !== null ? `${row.dso} j` : "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell>Total</TableCell>
              <TableCell className="text-right tabular-nums">{total.count}</TableCell>
              {total.buckets.map((value, index) => (
                <TableCell key={index} className="text-right tabular-nums">
                  {formatDA(value)}
                </TableCell>
              ))}
              <TableCell className="text-right tabular-nums">{formatDA(total.undated)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatDA(total.total)}</TableCell>
              <TableCell />
            </TableRow>
          </TableFooter>
        </Table>
      </div>
    </>
  );
}

async function Treasury({ user }: Readonly<{ user: User }>): Promise<React.JSX.Element> {
  const result = await treasuryForecast(user);
  if (!result.success) return <StateMessage kind="error" title="Prévision indisponible" message={result.error} />;
  const f = result.data;
  const columns = ["Déjà échu / immédiat", "J+1 à J+30", "J+31 à J+60", "J+61 à J+90"];
  const line = (label: string, values: number[], strong = false, signed = false): React.JSX.Element => (
    <TableRow className={strong ? "font-semibold" : undefined}>
      <TableCell>{label}</TableCell>
      {values.map((value, index) => (
        <TableCell key={index} className={cn("text-right tabular-nums", signed && value < 0 && "text-destructive", signed && value > 0 && "text-success")}>
          {value ? formatDA(value) : "·"}
        </TableCell>
      ))}
    </TableRow>
  );
  return (
    <>
      <p className="mb-3 text-sm text-muted-foreground">
        Encaissements attendus : chaque facture en attente est placée à sa date probable de paiement (date de facture + délai réel du partenaire ; 60 jours si inconnu). Décaissements : factures fournisseurs en attente (immédiat), puis moyenne mensuelle des 3 derniers mois. Le solde bancaire de départ n&apos;est pas suivi : le tableau montre le flux net.
      </p>
      <div className="overflow-x-auto rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead />
              {columns.map((column) => (
                <TableHead key={column} className="text-right">
                  {column}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {line("Encaissements attendus", f.inflows, true)}
            {line("Prestataires (assistance, BDG, TPA)", f.providers)}
            {line("Charges de personnel", f.payroll)}
            {line("Autres fournisseurs et charges", f.others)}
            {line("Décaissements", f.outflows, true)}
          </TableBody>
          <TableFooter>
            {line("Flux net", f.net, true, true)}
            {line("Flux net cumulé", f.cumulative, true, true)}
          </TableFooter>
        </Table>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        Moyennes mensuelles ({f.averages.months.join(", ")}) : prestataires {formatDA(f.averages.providers)} · personnel {formatDA(f.averages.payroll)} · autres {formatDA(f.averages.others)}.
      </p>
    </>
  );
}

async function Margins({ user, year, currentYear }: Readonly<{ user: User; year: number; currentYear: number }>): Promise<React.JSX.Element> {
  const result = await activityMargins(user, year);
  if (!result.success) return <StateMessage kind="error" title="Rentabilité indisponible" message={result.error} />;
  return (
    <>
      <div className="mb-3 flex flex-wrap gap-1">
        {[currentYear, currentYear - 1, currentYear - 2].map((value) => (
          <Link key={value} href={`/pilotage?onglet=rentabilite&annee=${value}`} className={buttonVariants({ size: "sm", variant: value === year ? "default" : "outline" })}>
            {value}
          </Link>
        ))}
      </div>
      <p className="mb-4 text-sm text-muted-foreground">Production = factures clients de l&apos;année {year} par mois de facture (TTC saisi). Coût = paiements aux prestataires de l&apos;activité par mois de règlement. Marge indicative : ni la paie ni les frais généraux ne sont comptés.</p>
      {result.data.length === 0 ? <StateMessage kind="empty" title="Aucune donnée" message={`Rien de facturé ni payé en ${year}.`} /> : null}
      <div className="flex flex-col gap-6">
        {result.data.map((activity) => {
          const margin = activity.totalProduction - activity.totalCost;
          return (
            <section key={activity.key}>
              <h2 className="mb-2 text-lg font-semibold">
                {activity.label}{" "}
                <span className="text-sm font-normal text-muted-foreground">
                  · marge {formatDA(margin)} ({activity.totalProduction ? Math.round((margin / activity.totalProduction) * 1000) / 10 : 0} %)
                </span>
              </h2>
              <div className="overflow-x-auto rounded-lg border bg-card">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead />
                      {MONTHS_FR.map((month) => (
                        <TableHead key={month} className="text-right">
                          {month.slice(0, 4)}
                        </TableHead>
                      ))}
                      <TableHead className="text-right">Année</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(
                      [
                        ["Production", activity.production, activity.totalProduction],
                        ["Coût prestataires", activity.cost, activity.totalCost],
                        ["Marge", activity.production.map((value, index) => value - (activity.cost[index] ?? 0)), margin],
                      ] as const
                    ).map(([label, values, total]) => (
                      <TableRow key={label} className={label === "Marge" ? "font-semibold" : undefined}>
                        <TableCell>{label}</TableCell>
                        {values.map((value, index) => (
                          <TableCell key={index} className={cn("text-right tabular-nums", label === "Marge" && value < 0 && "text-destructive")}>
                            {value ? formatCompact(value) : "·"}
                          </TableCell>
                        ))}
                        <TableCell className={cn("text-right tabular-nums", label === "Marge" && total < 0 && "text-destructive")}>{formatCompact(total)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}

async function Settings({ isAdmin }: Readonly<{ isAdmin: boolean }>): Promise<React.JSX.Element> {
  const settings = await getControlSettings();
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
      <Card className="p-4">
        <h2 className="mb-3 text-lg font-semibold">Paramètres de contrôle</h2>
        <ControlSettingsForm initial={settings} canEdit={isAdmin} />
        <p className="mt-4 text-sm text-muted-foreground">
          Règles en place : un changement de RIB n&apos;est validé que par un administrateur ; un envoi dont un prestataire dépasse le seuil mensuel n&apos;est validé que par un administrateur ; une facture émise ne se modifie que par un administrateur, avec motif, et l&apos;ancienne version est conservée.
        </p>
      </Card>
      <Card className="p-4">
        <h2 className="mb-2 text-lg font-semibold">Sauvegarde complète</h2>
        <p className="mb-3 text-sm text-muted-foreground">Toutes les données d&apos;AssistPay (factures, relevé, demandes de paiement, factures établies, contrôles CAAR, virements, RIB et RH si vous y avez accès). À faire chaque fin de mois, en complément de la sauvegarde de la base PostgreSQL.</p>
        <div className="flex flex-wrap gap-2">
          <a href="/api/sauvegarde?format=xlsx" className={buttonVariants()}>
            <Download />
            Excel lisible
          </a>
          <a href="/api/sauvegarde?format=json" className={buttonVariants({ variant: "outline" })}>
            <Download />
            JSON complet
          </a>
        </div>
      </Card>
    </div>
  );
}
