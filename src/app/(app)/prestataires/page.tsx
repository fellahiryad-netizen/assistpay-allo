import type { Metadata } from "next";
import Link from "next/link";
import { ChevronDown, Plus } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { can } from "@/features/access/services/access-rules";
import { PageHeader } from "@/components/common/page-header";
import { StateMessage } from "@/components/common/state-message";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { AutoSubmitSwitch } from "@/features/invoices/components/auto-submit-switch";
import { InvoiceImportDialog } from "@/features/invoices/components/invoice-import-dialog";
import { ProviderActivityKpi } from "@/features/invoices/components/provider-activity-kpi";
import { ProviderActivitySection } from "@/features/invoices/components/provider-activity-section";
import { ACTIVITIES, ACTIVITY_LABELS, parseActivity, type Activity } from "@/features/invoices/lib/activity";
import { providerBalances } from "@/features/invoices/services/provider-service";
import { formatDA } from "@/utils/format";

export const metadata: Metadata = { title: "Prestataires" };

const DESCRIPTIONS: Readonly<Record<Activity, string>> = {
  assistance: "Prestataires d'assistance routière : dépannage et remorquage.",
  bdg: "Prestataires de bris de glace.",
  autre: "Autres fournisseurs : TVA, TPA, IT et divers.",
};

/** Prestataires : soldes et impayés séparés par activité (assistance, BDG, autre), avec accès aux demandes de paiement. */
export default async function ProvidersPage({ searchParams }: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>): Promise<React.JSX.Element> {
  const user = await requireUser();
  const raw = await searchParams;
  const one = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value) || undefined;
  const year = Number(one(raw.annee)) || undefined;
  const q = one(raw.q);
  const activity = parseActivity(one(raw.activite));
  const showSettled = one(raw.soldes) === "1";
  const result = await providerBalances(user, { q, year });
  if (!result.success) return <StateMessage kind={result.code === "FORBIDDEN" ? "forbidden" : "error"} title="Prestataires indisponibles" message={result.error} />;
  const data = result.data;
  const { assistance, bdg, autre } = data.activities;

  /** Lien d'une carte : choisit l'activité, ou revient à toutes si elle est déjà choisie ; recherche, année et soldés sont conservés. */
  const kpiHref = (target: Activity): string => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (year) params.set("annee", String(year));
    if (showSettled) params.set("soldes", "1");
    if (activity !== target) params.set("activite", target);
    const search = params.toString();
    return search ? `/prestataires?${search}` : "/prestataires";
  };
  const section = (target: Activity): React.JSX.Element => <ProviderActivitySection group={data.activities[target]} showSettled={showSettled} canEdit={data.canEdit} year={year} description={DESCRIPTIONS[target]} />;
  const mainSections = ACTIVITIES.filter((target) => target !== "autre" && (!activity || activity === target));
  const showOther = !activity || activity === "autre";

  return (
    <>
      <PageHeader
        title="Prestataires"
        description={`À payer : Assistance ${formatDA(assistance.due)} · BDG ${formatDA(bdg.due)} · Autre ${formatDA(autre.due)}, soit ${formatDA(data.due)} sur ${data.pending} facture(s) impayée(s).`}
        actions={
          data.canEdit ? (
            <>
              {can(user, "A_IMPORT", "EDIT") ? <InvoiceImportDialog /> : null}
              <Link href="/factures/nouvelle?sens=DEBIT" className={buttonVariants()}>
                <Plus />
                Ajouter une facture prestataire
              </Link>
            </>
          ) : undefined
        }
      />
      <div className="mb-5 grid grid-cols-1 gap-3 md:grid-cols-3">
        {ACTIVITIES.map((target) => (
          <ProviderActivityKpi key={target} group={data.activities[target]} href={kpiHref(target)} active={activity === target} />
        ))}
      </div>
      <form method="get" className="mb-5 grid grid-cols-1 items-center gap-2 sm:grid-cols-6" role="search">
        <Input name="q" defaultValue={q ?? ""} placeholder="Nom du prestataire…" aria-label="Recherche" className="sm:col-span-2" />
        <NativeSelect name="annee" defaultValue={year ? String(year) : ""} aria-label="Année">
          <option value="">Toutes les années</option>
          {data.years.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect name="activite" defaultValue={activity ?? ""} aria-label="Activité">
          <option value="">Toutes les activités</option>
          {ACTIVITIES.map((value) => (
            <option key={value} value={value}>
              {ACTIVITY_LABELS[value]}
            </option>
          ))}
        </NativeSelect>
        <AutoSubmitSwitch name="soldes" label="Afficher les soldés" defaultChecked={showSettled} />
        <Button type="submit">Filtrer</Button>
      </form>
      <div className={mainSections.length > 1 ? "grid grid-cols-1 items-start gap-5 xl:grid-cols-2" : "grid grid-cols-1 gap-5"}>
        {mainSections.map((target) => (
          <div key={target} className="min-w-0">
            {section(target)}
          </div>
        ))}
      </div>
      {showOther ? (
        <details className="group mt-6 rounded-lg border bg-card/50" open={activity === "autre"}>
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg p-4 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <span>
              Autre <span className="ml-2 text-sm font-normal text-muted-foreground">{formatDA(autre.due)} à payer · {autre.providers} prestataire(s) en attente</span>
            </span>
            <ChevronDown aria-hidden className="size-4 transition-transform group-open:rotate-180" />
          </summary>
          <div className="p-4 pt-0">{section("autre")}</div>
        </details>
      ) : null}
    </>
  );
}
