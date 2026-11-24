"use client";

import { useMemo, useState, useTransition } from "react";
import { ChevronLeft, ChevronRight, Download, Eye } from "lucide-react";
import { updateEnvoiAction } from "@/app/actions/envoi-actions";
import { Notice } from "@/components/common/notice";
import { StateMessage } from "@/components/common/state-message";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EnvoiDetailDialog, STATUT_VARIANT } from "@/features/courrier/components/envoi-detail-dialog";
import { algiersDateTime, EMPTY_FILTERS, ENVOI_SORTS, filterEnvois, paginate, sortEnvois, type EnvoiSort } from "@/features/courrier/lib/envois";
import { COURRIER_COMPANIES, ENVOI_STATUTS, ENVOI_STATUT_LABELS, type Envoi, type EnvoiFilters } from "@/features/courrier/types";
import { cn } from "@/utils/cn";
import { formatDate } from "@/utils/format";

/** Propriétés de l'historique des bordereaux. */
export interface EnvoiHistoryProps {
  envois: Envoi[];
  canEdit: boolean;
  /** Droit d'export Excel (bouton affiché seulement s'il est accordé). */
  canExport: boolean;
  /** Date du jour `AAAA-MM-JJ` (fuseau d'Alger). */
  today: string;
  initialFilters: EnvoiFilters;
}

const PAGE_SIZE = 25;
const SORT_LABELS: Readonly<Record<EnvoiSort, string>> = {
  "numero-desc": "N° (récents d'abord)",
  "numero-asc": "N° (anciens d'abord)",
  "creation-desc": "Création (récente d'abord)",
  "creation-asc": "Création (ancienne d'abord)",
  "ramassage-desc": "Ramassage (récent d'abord)",
  "ramassage-asc": "Ramassage (non renseignés d'abord)",
};

/** Liste courte des destinations : les deux premières, puis « + n ». */
function shortDestinations(envoi: Envoi): string {
  const names = [...new Set(envoi.lignes.map((line) => line.destination || line.designation))];
  return names.length <= 2 ? names.join(", ") : `${names.slice(0, 2).join(", ")} + ${names.length - 2}`;
}

/** Historique des bordereaux : recherche, filtres, tri, pagination, date de ramassage modifiable en ligne, détail, export Excel. */
export function EnvoiHistory({ envois, canEdit, canExport, today, initialFilters }: Readonly<EnvoiHistoryProps>): React.JSX.Element {
  const [filters, setFilters] = useState<EnvoiFilters>(initialFilters);
  const [sort, setSort] = useState<EnvoiSort>("numero-desc");
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ numero: string; value: string } | null>(null);
  const [feedback, setFeedback] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const filtered = useMemo(() => sortEnvois(filterEnvois(envois, filters), sort), [envois, filters, sort]);
  const view = paginate(filtered, page, PAGE_SIZE);
  const opened = detail ? (envois.find((item) => item.numero === detail) ?? null) : null;
  const set = <K extends keyof EnvoiFilters>(key: K, value: EnvoiFilters[K]): void => {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  };
  const exportHref = `/api/courrier/envois?${new URLSearchParams(Object.entries(filters).filter(([, value]) => value !== "")).toString()}`;
  const filtersActive = Object.values(filters).some((value) => value !== "");

  function savePickup(envoi: Envoi, ramasseLe: string): void {
    setFeedback(null);
    startTransition(async () => {
      const result = await updateEnvoiAction({ numero: envoi.numero, ramasseLe, ramasseur: envoi.ramasseur, remarque: envoi.remarque });
      if (result.success) {
        setEditing(null);
        setFeedback({ tone: "success", text: ramasseLe ? `Ramassage du ${formatDate(ramasseLe)} enregistré pour ${envoi.numero}.` : `Date de ramassage effacée pour ${envoi.numero}.` });
      } else setFeedback({ tone: "error", text: result.error });
    });
  }

  return (
    <>
      {feedback ? (
        <Notice tone={feedback.tone} className="mb-4">
          {feedback.text}
        </Notice>
      ) : null}
      <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Input type="search" value={filters.q} onChange={(event) => set("q", event.target.value)} placeholder="Rechercher (N°, succursale, destination…)" aria-label="Rechercher un bordereau" className="sm:col-span-2" />
        <label className="flex items-center gap-2 text-sm">
          <span className="w-16 shrink-0 text-muted-foreground">Créé du</span>
          <Input type="date" value={filters.du} onChange={(event) => set("du", event.target.value)} aria-label="Créé à partir du" />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <span className="w-16 shrink-0 text-muted-foreground">au</span>
          <Input type="date" value={filters.au} onChange={(event) => set("au", event.target.value)} aria-label="Créé jusqu'au" />
        </label>
        <NativeSelect value={filters.ramasse} onChange={(event) => set("ramasse", event.target.value === "oui" ? "oui" : event.target.value === "non" ? "non" : "")} aria-label="Ramassage">
          <option value="">Ramassé ou non</option>
          <option value="oui">Ramassés</option>
          <option value="non">Sans date de ramassage</option>
        </NativeSelect>
        <NativeSelect value={filters.statut} onChange={(event) => set("statut", ENVOI_STATUTS.find((statut) => statut === event.target.value) ?? "")} aria-label="Statut">
          <option value="">Tous les statuts</option>
          {ENVOI_STATUTS.map((statut) => (
            <option key={statut} value={statut}>
              {ENVOI_STATUT_LABELS[statut]}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect value={filters.compagnie} onChange={(event) => set("compagnie", COURRIER_COMPANIES.find((company) => company === event.target.value) ?? "")} aria-label="Compagnie">
          <option value="">Toutes les compagnies</option>
          {COURRIER_COMPANIES.map((company) => (
            <option key={company}>{company}</option>
          ))}
        </NativeSelect>
        <NativeSelect value={sort} onChange={(event) => setSort(ENVOI_SORTS.find((item) => item === event.target.value) ?? "numero-desc")} aria-label="Trier par">
          {ENVOI_SORTS.map((item) => (
            <option key={item} value={item}>
              Tri : {SORT_LABELS[item]}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {filtered.length} bordereau{filtered.length > 1 ? "x" : ""} sur {envois.length}
        </p>
        {filtersActive ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => { setFilters(EMPTY_FILTERS); setPage(1); }}>
            Effacer les filtres
          </Button>
        ) : null}
        {canExport && filtered.length > 0 ? (
          <a href={exportHref} className="ml-auto inline-flex h-8 items-center justify-center gap-2 rounded-md border border-input bg-card px-3 text-xs font-medium hover:bg-muted">
            <Download className="size-4" aria-hidden />
            Exporter en Excel ({filtered.length})
          </a>
        ) : null}
      </div>

      {filtered.length === 0 ? (
        <StateMessage kind="empty" title={envois.length === 0 ? "Aucun bordereau établi" : "Aucun bordereau ne correspond"} message={envois.length === 0 ? "Les bordereaux enregistrés depuis « Adresses courrier » apparaîtront ici." : "Essayez d'autres filtres."} />
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>N°</TableHead>
                <TableHead>Création</TableHead>
                <TableHead>Ramassage</TableHead>
                <TableHead>Ramasseur</TableHead>
                <TableHead className="text-right">Plis</TableHead>
                <TableHead>Destinations</TableHead>
                <TableHead>Créé par</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead className="text-right">Détail</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {view.items.map((item) => {
                const cancelled = item.statut === "ANNULE";
                return (
                  <TableRow key={item.numero} className={cn(cancelled && "text-muted-foreground")}>
                    <TableCell className={cn("whitespace-nowrap font-medium", cancelled && "line-through")}>{item.numero}</TableCell>
                    <TableCell className={cn("whitespace-nowrap", cancelled && "line-through")}>{algiersDateTime(item.creeLe)}</TableCell>
                    <TableCell className="min-w-44">
                      {cancelled ? (
                        <span>—</span>
                      ) : editing?.numero === item.numero ? (
                        <div className="flex flex-wrap items-center gap-1">
                          <Input type="date" value={editing.value} max={today} min={item.date || undefined} onChange={(event) => setEditing({ numero: item.numero, value: event.target.value })} className="h-8 w-40" aria-label={`Date de ramassage de ${item.numero}`} />
                          <Button type="button" size="sm" onClick={() => savePickup(item, editing.value)} disabled={pending}>
                            OK
                          </Button>
                          <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)} disabled={pending}>
                            Annuler
                          </Button>
                        </div>
                      ) : item.ramasseLe ? (
                        <span className="inline-flex items-center gap-2">
                          {formatDate(item.ramasseLe)}
                          {canEdit ? (
                            <button type="button" className="text-xs font-medium text-primary hover:underline" onClick={() => setEditing({ numero: item.numero, value: item.ramasseLe })}>
                              Modifier
                            </button>
                          ) : null}
                        </span>
                      ) : (
                        <span className="flex flex-wrap items-center gap-1">
                          <Badge variant="warning">à renseigner</Badge>
                          {canEdit ? (
                            <>
                              <button type="button" className="text-xs font-medium text-primary hover:underline disabled:opacity-50" onClick={() => savePickup(item, today)} disabled={pending}>
                                Ramassé aujourd&apos;hui
                              </button>
                              <button type="button" className="text-xs font-medium text-primary hover:underline" onClick={() => setEditing({ numero: item.numero, value: today })}>
                                Autre date
                              </button>
                            </>
                          ) : null}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>{item.ramasseur || <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="text-right tabular-nums">{item.total}</TableCell>
                    <TableCell className="min-w-48">{shortDestinations(item)}</TableCell>
                    <TableCell>{item.creePar || "—"}</TableCell>
                    <TableCell>
                      <Badge variant={STATUT_VARIANT[item.statut]}>{ENVOI_STATUT_LABELS[item.statut]}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <button type="button" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline" onClick={() => setDetail(item.numero)} aria-label={`Détail du bordereau ${item.numero}`}>
                        <Eye className="size-3.5" aria-hidden />
                        Détail
                      </button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
      {view.pageCount > 1 ? (
        <nav className="flex items-center justify-between gap-2 pt-4" aria-label="Pagination">
          <Button type="button" variant="outline" size="sm" onClick={() => setPage(view.page - 1)} disabled={view.page <= 1}>
            <ChevronLeft /> Précédent
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {view.page} sur {view.pageCount}
          </span>
          <Button type="button" variant="outline" size="sm" onClick={() => setPage(view.page + 1)} disabled={view.page >= view.pageCount}>
            Suivant <ChevronRight />
          </Button>
        </nav>
      ) : null}
      <EnvoiDetailDialog envoi={opened} canEdit={canEdit} today={today} onClose={() => setDetail(null)} onDone={(text) => setFeedback({ tone: "success", text })} />
    </>
  );
}
