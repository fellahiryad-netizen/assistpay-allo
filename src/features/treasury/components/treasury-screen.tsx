import Link from "next/link";
import { Download, FileText, Printer } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { StateMessage } from "@/components/common/state-message";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BalanceChart } from "@/features/treasury/components/balance-chart";
import { SimulationPanel } from "@/features/treasury/components/simulation-panel";
import { BalanceCard, Kpis } from "@/features/treasury/components/treasury-cards";
import { DuplicatesBanner, FreshnessBanner, RejectionBanner, SimulationBanner, VerdictCard } from "@/features/treasury/components/treasury-banners";
import { ControlsBlock, FooterMention, HypothesesBlock } from "@/features/treasury/components/treasury-notes";
import { TreasurySettingsPanel } from "@/features/treasury/components/treasury-settings";
import { ExpectedTable, PriorityBlock, ScheduleTable } from "@/features/treasury/components/treasury-tables";
import { buildHypotheses } from "@/features/treasury/lib/hypotheses";
import type { TreasuryView } from "@/features/treasury/types/view";
import { cn } from "@/utils/cn";
import { formatDA } from "@/utils/format";

/**
 * Écran Trésorerie : lecture pour la direction (solde, verdict, indicateurs, graphique, échéancier, hypothèses, contrôles),
 * puis espace de la comptable (simulation) et réglages de l'administrateur.
 */
export function TreasuryScreen({ view }: Readonly<{ view: TreasuryView }>): React.JSX.Element {
  const { balance, computation } = view;
  const query = view.includeRequests ? "?demandes=1" : "";
  const actions = (
    <>
      {computation ? (
        <>
          <Link href={`/imprimer/tresorerie${query}`} target="_blank" className={buttonVariants({ variant: "outline" })}>
            <Printer />
            Imprimer (noir et blanc)
          </Link>
          <a href={`/api/tresorerie/export?format=xlsx${query ? "&demandes=1" : ""}`} className={buttonVariants({ variant: "outline" })}>
            <Download />
            Exporter en Excel
          </a>
          <a href={`/api/tresorerie/export?format=pdf${query ? "&demandes=1" : ""}`} className={buttonVariants({ variant: "outline" })}>
            <FileText />
            Exporter en PDF (présentation)
          </a>
        </>
      ) : null}
    </>
  );

  if (!balance || !computation) {
    return (
      <div className="space-y-4">
        <PageHeader title="Trésorerie" description="Solde du compte AGB, paiements à venir et risque de découvert. Confidentiel." />
        {view.rejection ? <RejectionBanner rejection={view.rejection} /> : null}
        <StateMessage kind="empty" title="Aucun solde disponible" message="Importez un relevé AGB dans « Relevé bancaire » : le solde est lu dans la ligne « Solde FIN AU ». À défaut, l'administrateur peut saisir un solde de secours ci-dessous." />
        {view.permissions.settings ? <TreasurySettingsPanel coussinJours={view.settings.coussinJours} encaissementsAttendus={view.settings.encaissementsAttendus} hasManual={view.manual.has} manualAllowed={view.manual.allowed} today={view.today} /> : null}
        <FooterMention />
      </div>
    );
  }

  const hypotheses = buildHypotheses({
    balance,
    computation,
    scenarioName: view.active?.nom ?? null,
    scenarioLines: view.active?.lignes.length ?? 0,
    expectedEnabled: view.settings.encaissementsAttendus,
    includeRequests: view.includeRequests,
  });

  return (
    <div className="space-y-4">
      <PageHeader title="Trésorerie" description="Solde du compte AGB, paiements à venir et risque de découvert. Confidentiel : Administrateur, Direction et Comptable." actions={actions} />
      {view.active ? <SimulationBanner name={view.active.nom} by={view.active.creePar} createdAt={view.active.creeLe} lines={view.active.lignes.length} /> : null}
      {view.duplicates ? <DuplicatesBanner duplicates={view.duplicates} /> : null}
      <FreshnessBanner balance={balance} />
      {view.rejection ? <RejectionBanner rejection={view.rejection} /> : null}
      <BalanceCard balance={balance} computation={computation} cheques={view.cheques} />
      <VerdictCard verdict={computation.verdict} />
      <Kpis computation={computation} />
      {computation.balanceAfterExpected !== null ? (
        <p className="rounded-md border border-dashed p-2 text-sm">
          Avec les encaissements attendus ({formatDA(computation.expected.total)}, attendus et non garantis) : solde après paiements de <b>{formatDA(computation.balanceAfterExpected)}</b>. Ce chiffre n&apos;entre pas dans le niveau de risque.
        </p>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>Évolution prévue du solde</CardTitle>
          <CardDescription>Historique du relevé (trait plein), puis projection sans encaissement (pointillé).</CardDescription>
        </CardHeader>
        <CardContent>
          <BalanceChart bank={computation.bank} history={view.history} projection={computation.timeline.points} cushion={computation.cushion} lowest={computation.timeline.lowest} overdraftDate={computation.timeline.overdraftDate} />
        </CardContent>
      </Card>
      <ScheduleTable computation={computation} requestsIncluded={view.includeRequests} />
      <Card>
        <CardHeader>
          <CardTitle>Demandes de paiement sans facture liée</CardTitle>
          <CardDescription>
            {view.requestsWithoutInvoice.length} demande{view.requestsWithoutInvoice.length > 1 ? "s" : ""} pour {formatDA(computation.requestsInfo.total)}, à confirmer : elles sont peut-être déjà virées. Hors total par défaut.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link href={view.includeRequests ? "/tresorerie" : "/tresorerie?demandes=1"} className={cn(buttonVariants({ variant: view.includeRequests ? "violet" : "outline", size: "sm" }))}>
            {view.includeRequests ? "Ne plus les inclure dans le reste à payer" : "Les inclure dans le reste à payer"}
          </Link>
        </CardContent>
      </Card>
      <ExpectedTable rows={computation.expected.rows} enabled={view.settings.encaissementsAttendus} />
      <PriorityBlock computation={computation} />
      <HypothesesBlock lines={hypotheses} />
      <ControlsBlock controls={view.controls} />
      <h2 className="pt-2 text-lg font-semibold">Espace de la comptable</h2>
      <SimulationPanel scenarios={view.scenarios} active={view.active} suggestions={view.suggestions} balanceDate={balance.date} />
      {view.permissions.settings ? <TreasurySettingsPanel coussinJours={view.settings.coussinJours} encaissementsAttendus={view.settings.encaissementsAttendus} hasManual={view.manual.has} manualAllowed={view.manual.allowed} today={view.today} /> : null}
      <FooterMention />
    </div>
  );
}
