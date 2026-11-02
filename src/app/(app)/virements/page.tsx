import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/common/page-header";
import { StateMessage } from "@/components/common/state-message";
import { TabsNav } from "@/components/common/tabs-nav";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BatchHistory, monthRank } from "@/features/transfers/components/batch-history";
import { RibFormDialog } from "@/features/transfers/components/rib-form-dialog";
import { RibTable } from "@/features/transfers/components/rib-table";
import { UploadCheck } from "@/features/transfers/components/upload-check";
import { ribQuerySchema } from "@/features/transfers/schemas";
import { listRibs } from "@/features/transfers/services/rib-service";
import { listBatches } from "@/features/transfers/services/transfer-service";
import { MONTHS_FR, todayIso } from "@/utils/dates";

export const metadata: Metadata = { title: "Virements et RIB" };

/** Virements et RIB : historique des envois, contrôle d'un fichier, référentiel RIB. */
export default async function TransfersPage({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>): Promise<React.JSX.Element> {
  const user = await requireUser();
  const raw = await searchParams;
  const one = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value) || undefined;
  const tab = one(raw.onglet) ?? "envois";
  const today = todayIso();
  const yearParam = one(raw.annee) ?? today.slice(0, 4);
  const year = yearParam === "toutes" ? null : Number(yearParam);
  const monthFilter = Number(one(raw.mois) ?? 0) || 0;
  const productFilter = one(raw.produit) ?? "";
  const statusFilter = one(raw.statut) ?? "";
  const [history, ribs] = await Promise.all([
    tab === "envois" ? listBatches(user, year !== null && Number.isFinite(year) ? year : null) : Promise.resolve(null),
    tab === "rib" ? listRibs(user, ribQuerySchema.parse({ filtre: one(raw.filtre), q: one(raw.q) })) : Promise.resolve(null),
  ]);
  const ribQuery = ribQuerySchema.parse({ filtre: one(raw.filtre), q: one(raw.q) });
  return (
    <>
      <PageHeader
        title="Virements et RIB"
        description="États des virements envoyés à la banque, contrôle des fichiers et référentiel des RIB prestataires."
        actions={
          <Link href="/virements/nouveau" className={buttonVariants()}>
            <Plus />
            État des virements
          </Link>
        }
      />
      <TabsNav
        tabs={[
          { href: "/virements?onglet=envois", label: "Envois", active: tab === "envois" },
          { href: "/virements?onglet=controle", label: "Contrôler un fichier", active: tab === "controle" },
          { href: "/virements?onglet=rib&filtre=a_valider", label: "Référentiel RIB", active: tab === "rib" },
        ]}
      />
      {tab === "envois" && history ? (
        !history.success ? (
          <StateMessage kind={history.code === "FORBIDDEN" ? "forbidden" : "error"} title="Historique indisponible" message={history.error} />
        ) : (
          <>
            {(() => {
              const all = history.data.batches;
              const filtered = all.filter(
                (batch) => (!monthFilter || monthRank(batch.mois) === monthFilter) && (!productFilter || batch.type === productFilter) && (!statusFilter || batch.status === statusFilter),
              );
              const link = (patch: Record<string, string>): string => {
                const params = new URLSearchParams({ onglet: "envois", annee: yearParam, ...(monthFilter ? { mois: String(monthFilter) } : {}), ...(productFilter ? { produit: productFilter } : {}), ...(statusFilter ? { statut: statusFilter } : {}), ...patch });
                for (const [key, value] of [...params.entries()]) if (!value) params.delete(key);
                return `/virements?${params.toString()}`;
              };
              const chip = (active: boolean): string => buttonVariants({ size: "sm", variant: active ? "default" : "outline" });
              const monthCount = (rank: number): number => all.filter((batch) => monthRank(batch.mois) === rank).length;
              return (
                <>
                  <div className="mb-2 flex flex-wrap items-center gap-1">
                    <span className="mr-1 text-xs text-muted-foreground">Année</span>
                    {history.data.years.map((value) => (
                      <Link key={value} href={link({ annee: String(value), mois: "" })} className={chip(value === year)}>
                        {value}
                      </Link>
                    ))}
                    <Link href={link({ annee: "toutes", mois: "" })} className={chip(year === null)}>
                      Toutes
                    </Link>
                  </div>
                  <div className="mb-2 flex flex-wrap items-center gap-1">
                    <span className="mr-1 text-xs text-muted-foreground">Mois</span>
                    <Link href={link({ mois: "" })} className={chip(monthFilter === 0)}>
                      Tous
                    </Link>
                    {MONTHS_FR.map((name, index) => (
                      <Link key={name} href={link({ mois: String(index + 1) })} className={chip(monthFilter === index + 1)} aria-disabled={monthCount(index + 1) === 0}>
                        {name.slice(0, 4)}.{monthCount(index + 1) ? ` (${monthCount(index + 1)})` : ""}
                      </Link>
                    ))}
                  </div>
                  <div className="mb-3 flex flex-wrap items-center gap-1">
                    <span className="mr-1 text-xs text-muted-foreground">Activité</span>
                    {([["", "Toutes"], ["A", "Assistance routière"], ["B", "BDG"]] as const).map(([value, label]) => (
                      <Link key={label} href={link({ produit: value })} className={chip(productFilter === value)}>
                        {label}
                      </Link>
                    ))}
                    <span className="ml-3 mr-1 text-xs text-muted-foreground">Statut</span>
                    {([["", "Tous"], ["valide", "Validés"], ["attente", "En attente"], ["rejete", "Rejetés"]] as const).map(([value, label]) => (
                      <Link key={label} href={link({ statut: value })} className={chip(statusFilter === value)}>
                        {label}
                      </Link>
                    ))}
                  </div>
                  {filtered.length ? <BatchHistory batches={filtered} /> : <StateMessage kind="empty" title="Aucun envoi pour ce filtre" />}
                </>
              );
            })()}
          </>
        )
      ) : null}
      {tab === "controle" ? <UploadCheck month={MONTHS_FR[Number(today.slice(5, 7)) - 1] ?? "Janvier"} year={Number(today.slice(0, 4))} /> : null}
      {tab === "rib" && ribs ? (
        !ribs.success ? (
          <StateMessage kind={ribs.code === "FORBIDDEN" ? "forbidden" : "error"} title="Référentiel indisponible" message={ribs.error} />
        ) : (
          <>
            <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="flex flex-wrap gap-1">
                {(
                  [
                    ["a_valider", `À valider (${ribs.data.counts.a_valider ?? 0})`],
                    ["actifs", `Actifs (${ribs.data.counts.actif ?? 0})`],
                    ["supprimes", "Supprimés / remplacés"],
                    ["tous", "Tous"],
                  ] as const
                ).map(([value, label]) => (
                  <Link key={value} href={`/virements?onglet=rib&filtre=${value}`} className={buttonVariants({ size: "sm", variant: ribQuery.filtre === value ? "default" : "outline" })}>
                    {label}
                  </Link>
                ))}
              </div>
              <form method="get" className="flex gap-2 sm:ml-auto" role="search">
                <input type="hidden" name="onglet" value="rib" />
                <input type="hidden" name="filtre" value="tous" />
                <Input name="q" defaultValue={ribQuery.q ?? ""} placeholder="Nom, RIB, wilaya…" aria-label="Rechercher un RIB" />
                <Button type="submit" variant="outline">
                  Rechercher
                </Button>
              </form>
              {ribs.data.canEdit ? <RibFormDialog /> : null}
            </div>
            {ribs.data.ribs.length ? <RibTable ribs={ribs.data.ribs} canEdit={ribs.data.canEdit} isAdmin={ribs.data.isAdmin} /> : <StateMessage kind="empty" title="Aucun compte" />}
          </>
        )
      ) : null}
    </>
  );
}
