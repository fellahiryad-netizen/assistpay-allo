import { Notice } from "@/components/common/notice";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { f0, fm } from "@/features/regul/components/regul-format";
import { REGUL_LABELS, REGUL_MOIS, REGUL_SUCCURSALES } from "@/features/regul/services/regul-engine";
import { STATUT_LABELS, type PoliceRow, type PolicesView } from "@/features/regul/services/regul-polices";
import type { PolicesParams } from "@/features/regul/services/regul-polices-query";
import { cn } from "@/utils/cn";

const MAX_ROWS = 200;
const mois = (m: number): string => REGUL_MOIS[m - 1] ?? String(m);
const selectClass = "h-9 rounded-md border bg-background px-2 text-sm";

function exportHref(p: PolicesParams): string {
  const q = new URLSearchParams();
  if (p.succ) q.set("succ", p.succ);
  if (p.agence) q.set("agence", String(p.agence));
  if (p.statut) q.set("statut", p.statut);
  if (p.mois) q.set("mois", String(p.mois));
  return `/api/regul/polices?${q.toString()}`;
}

function PoliceTable({ title, rows, showStatut }: Readonly<{ title: string; rows: PoliceRow[]; showStatut: boolean }>): React.JSX.Element {
  const th = "px-2 py-1.5 text-left text-xs font-semibold";
  return (
    <details className="rounded-lg border bg-card" open={rows.length > 0 && rows.length <= 30}>
      <summary className="cursor-pointer px-3 py-2 text-sm font-semibold">
        {title} <span className="font-normal text-muted-foreground">({f0(rows.length)})</span>
      </summary>
      {rows.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="bg-muted/50">
                <th className={th}>Agence</th>
                <th className={th}>Mois</th>
                <th className={th}>Police</th>
                <th className={th}>Immatriculation</th>
                <th className={th}>Garantie</th>
                <th className={cn(th, "text-right")}>Part assisteur</th>
                {showStatut ? <th className={th}>Statut</th> : null}
                <th className={th}>Annulée</th>
                <th className={th}>Sinistre</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, MAX_ROWS).map((x) => (
                <tr key={`${x.mois}|${x.code}|${x.police}|${x.immat}|${x.source}`} className="border-t">
                  <td className="px-2 py-1">{x.code} {x.agence}</td>
                  <td className="px-2 py-1">{mois(x.mois)}</td>
                  <td className="px-2 py-1">{x.police}</td>
                  <td className="px-2 py-1">{x.immat}</td>
                  <td className="px-2 py-1">{x.garantie}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{fm(x.pa)}</td>
                  {showStatut ? (
                    <td className="px-2 py-1">
                      {x.statut ? STATUT_LABELS[x.statut] : ""}
                      {x.reapparition.length ? ` (${x.reapparition.map(mois).join(", ")}, ${x.reapparitionSource === "regul" ? "régul" : "avance"})` : ""}
                    </td>
                  ) : null}
                  <td className="px-2 py-1">{x.annulee ? "Oui" : "Non"}</td>
                  <td className="px-2 py-1">{x.sinistre === null ? "n/c" : x.sinistre ? "Oui" : "Non"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > MAX_ROWS ? <p className="px-3 py-2 text-xs text-muted-foreground">{f0(MAX_ROWS)} premières lignes affichées sur {f0(rows.length)} : l&apos;export Excel contient la liste complète.</p> : null}
        </div>
      ) : (
        <p className="px-3 pb-3 text-sm text-muted-foreground">Aucune police.</p>
      )}
    </details>
  );
}

/** Bloc « Polices non retrouvées » de CAAT Régul 10 % : filtres (URL), compteurs, ventilation succursale puis agence, listes et export Excel. */
export function RegulPolices({ view, params, error, canExport }: Readonly<{ view: PolicesView | null; params: PolicesParams; error: string | null; canExport: boolean }>): React.JSX.Element {
  const blocks = view?.blocks ?? [];
  const sum = (f: (b: (typeof blocks)[number]) => number): number => blocks.reduce((a, b) => a + f(b), 0);
  const counters: Array<[string, number]> = [
    ["Polices de l'avance absentes de la régul", sum((b) => b.result.absentes.length)],
    ["dont reportées", sum((b) => b.result.absentes.filter((x) => x.statut === "REPORTEE").length)],
    ["dont annulées", sum((b) => b.result.absentes.filter((x) => x.statut === "ANNULEE").length)],
    ["dont introuvables", sum((b) => b.result.absentes.filter((x) => x.statut === "INTROUVABLE").length)],
    ["Polices annulées", sum((b) => b.result.annulees.length)],
    ["Polices avec sinistre", sum((b) => b.result.sinistrees.length)],
    ["Annulées + sinistre", sum((b) => b.result.annuleesSinistre.length)],
  ];
  return (
    <div className="flex flex-col gap-4">
      <Card className="p-4">
        <h3 className="mb-1 font-semibold">Polices non retrouvées</h3>
        <p className="mb-3 text-sm text-muted-foreground">
          Polices du consolidé « avance 90 % » qui ne se retrouvent pas dans la régularisation 10 % du même mois : reportées sur un autre mois, annulées, ou introuvables sans explication. Le contrôle utilise les fichiers de régularisation conservés lors de « Enregistrer dans le suivi ».
        </p>
        <form method="get" className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="onglet" value="polices" />
          <label className="flex flex-col gap-1 text-sm">
            Succursale
            <select name="succ" defaultValue={params.succ} className={selectClass}>
              <option value="">Toutes</option>
              {REGUL_SUCCURSALES.map((s) => (
                <option key={s} value={s}>{REGUL_LABELS[s]}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Code agence
            <input name="agence" inputMode="numeric" defaultValue={params.agence ?? ""} className={cn(selectClass, "w-28")} placeholder="Toutes" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Statut
            <select name="statut" defaultValue={params.statut} className={selectClass}>
              <option value="">Tous</option>
              <option value="REPORTEE">Reportée</option>
              <option value="ANNULEE">Annulée</option>
              <option value="INTROUVABLE">Introuvable</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Mois
            <select name="mois" defaultValue={params.mois ?? ""} className={selectClass}>
              <option value="">Tous</option>
              {REGUL_MOIS.map((label, i) => (
                <option key={label} value={i + 1}>{label}</option>
              ))}
            </select>
          </label>
          <button type="submit" className={buttonVariants({ variant: "default" })}>Filtrer</button>
          {canExport && blocks.length ? (
            <a href={exportHref(params)} className={buttonVariants({ variant: "outline" })}>Exporter en Excel</a>
          ) : null}
        </form>
      </Card>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {view && !view.sinLoaded ? <Notice tone="warning">Base sinistres non chargée : les colonnes et listes « sinistre » sont vides ou non renseignées.</Notice> : null}
      {view?.sansRegul.length ? (
        <Notice tone="info">
          {view.sansRegul.map((s) => `${REGUL_LABELS[s] ?? s} : aucune régularisation conservée. Rechargez le fichier de régularisation de ${params.mois ? mois(params.mois).toLowerCase() : "chaque mois concerné"} pour obtenir ce contrôle.`).join(" ")}
        </Notice>
      ) : null}
      {blocks.map((b) =>
        b.result.moisSansRegul.length ? (
          <Notice key={`m-${b.result.succ}`} tone="warning">
            {REGUL_LABELS[b.result.succ] ?? b.result.succ} : rechargez le fichier de régularisation de {b.result.moisSansRegul.map((m) => mois(m).toLowerCase()).join(", ")} pour obtenir ce contrôle.
          </Notice>
        ) : null,
      )}
      {blocks.length ? (
        <>
          <div className="grid gap-2 sm:grid-cols-4 lg:grid-cols-7">
            {counters.map(([label, n]) => (
              <div key={label} className="rounded-lg border bg-card p-3">
                <span className="block text-lg font-semibold tabular-nums">{f0(n)}</span>
                <span className="text-xs text-muted-foreground">{label}</span>
              </div>
            ))}
          </div>
          {blocks.map((b) => (
            <Card key={b.result.succ} className="p-4">
              <h4 className="mb-2 font-semibold">
                {REGUL_LABELS[b.result.succ] ?? b.result.succ}
                <span className="ml-2 text-xs font-normal text-muted-foreground">régul conservée : {b.result.moisRegul.map((m) => mois(m).toLowerCase()).join(", ")}</span>
              </h4>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead>
                    <tr className="bg-muted/50 text-xs">
                      <th className="px-2 py-1.5 text-left">Agence</th>
                      <th className="px-2 py-1.5 text-right">Absentes</th>
                      <th className="px-2 py-1.5 text-right">Reportées</th>
                      <th className="px-2 py-1.5 text-right">Annulées</th>
                      <th className="px-2 py-1.5 text-right">Introuvables</th>
                      <th className="px-2 py-1.5 text-right">Polices annulées</th>
                      <th className="px-2 py-1.5 text-right">Sinistre</th>
                      <th className="px-2 py-1.5 text-right">Annulées + sinistre</th>
                    </tr>
                  </thead>
                  <tbody>
                    {b.agences.map((a) => (
                      <tr key={a.code} className="border-t">
                        <td className="px-2 py-1">{a.code} {a.agence}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{a.absentes}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{a.reportees}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{a.annulees}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{a.introuvables}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{a.annuleesTotal}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{a.sinistrees}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{a.annuleesSinistre}</td>
                      </tr>
                    ))}
                    <tr className="border-t font-semibold">
                      <td className="px-2 py-1">Total</td>
                      {([(a) => a.absentes, (a) => a.reportees, (a) => a.annulees, (a) => a.introuvables, (a) => a.annuleesTotal, (a) => a.sinistrees, (a) => a.annuleesSinistre] as Array<(a: (typeof b.agences)[number]) => number>).map((pick, i) => (
                        <td key={i} className="px-2 py-1 text-right tabular-nums">{b.agences.reduce((n, a) => n + pick(a), 0)}</td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="mt-3 flex flex-col gap-2">
                <PoliceTable title="Non retrouvées dans la régularisation" rows={b.result.absentes} showStatut />
                <PoliceTable title="Polices annulées" rows={b.result.annulees} showStatut={false} />
                <PoliceTable title="Polices avec sinistre" rows={b.result.sinistrees} showStatut={false} />
                <PoliceTable title="Annulées avec sinistre" rows={b.result.annuleesSinistre} showStatut={false} />
              </div>
            </Card>
          ))}
        </>
      ) : null}
    </div>
  );
}
