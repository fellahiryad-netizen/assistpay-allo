import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/common/page-header";
import { StateMessage } from "@/components/common/state-message";
import { TabsNav } from "@/components/common/tabs-nav";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BatchHistory } from "@/features/transfers/components/batch-history";
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
  const year = Number(one(raw.annee) ?? today.slice(0, 4));
  const [history, ribs] = await Promise.all([
    tab === "envois" ? listBatches(user, Number.isFinite(year) ? year : null) : Promise.resolve(null),
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
            <div className="mb-3 flex flex-wrap gap-1">
              {history.data.years.map((value) => (
                <Link key={value} href={`/virements?onglet=envois&annee=${value}`} className={buttonVariants({ size: "sm", variant: value === year ? "default" : "outline" })}>
                  {value}
                </Link>
              ))}
            </div>
            {history.data.batches.length ? <BatchHistory batches={history.data.batches} /> : <StateMessage kind="empty" title="Aucun envoi cette année" />}
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
