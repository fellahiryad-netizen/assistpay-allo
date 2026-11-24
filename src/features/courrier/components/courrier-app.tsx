"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { FileText, Pencil, Plus, Printer, Search, Trash2 } from "lucide-react";
import { deleteBranchAddressAction, deleteEmsContactAction } from "@/app/actions/courrier-actions";
import { Notice } from "@/components/common/notice";
import { StateMessage } from "@/components/common/state-message";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BranchDialog } from "@/features/courrier/components/branch-dialog";
import { EmsContactDialog, EmsSocieteDialog } from "@/features/courrier/components/ems-dialogs";
import { MailLink, PhoneLink } from "@/features/courrier/components/ems-card";
import { filterBranches } from "@/features/courrier/lib/address-book";
import { COURRIER_COMPANIES, EMS_ROLE_LABELS, type BranchAddress, type CourrierCompany, type EmsContact } from "@/features/courrier/types";
import { cn } from "@/utils/cn";

/** Propriétés de l'écran des adresses courrier. */
export interface CourrierAppProps {
  branches: BranchAddress[];
  emsSociete: string;
  emsContacts: EmsContact[];
  canEdit: boolean;
  /** Faux tant que la liste de départ du code n'a pas été enregistrée : la première modification l'enregistre. */
  persisted: boolean;
}

/** Adresse de la page d'impression pour une ou plusieurs fiches (une étiquette par page). */
export const envelopeHref = (ids: readonly string[]): string => `/imprimer/enveloppe?ids=${ids.map(encodeURIComponent).join(",")}`;

/** Adresse de l'aperçu modifiable du bordereau d'envoi pour une ou plusieurs fiches. */
export const bordereauPreviewHref = (ids: readonly string[]): string => `/adresses-courrier/bordereau?ids=${ids.map(encodeURIComponent).join(",")}`;

type Dialogs = { branch: BranchAddress | "new" | null; ems: EmsContact | "new" | null; societe: boolean };
type Feedback = { tone: "success" | "error"; text: string } | null;

/** Adresses courrier : succursales CAAR et CAAT (recherche, filtre, ajout, modification, suppression, impression d'enveloppes) et prestataire de courrier. */
export function CourrierApp({ branches, emsSociete, emsContacts, canEdit, persisted }: Readonly<CourrierAppProps>): React.JSX.Element {
  const [query, setQuery] = useState("");
  const [company, setCompany] = useState<CourrierCompany | "">("");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [dialogs, setDialogs] = useState<Dialogs>({ branch: null, ems: null, societe: false });
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [pending, startTransition] = useTransition();

  const sorted = useMemo(() => [...branches].sort((a, b) => a.compagnie.localeCompare(b.compagnie) || a.nom.localeCompare(b.nom, "fr", { numeric: true })), [branches]);
  const visible = useMemo(() => filterBranches(sorted, company, query), [sorted, company, query]);
  const visibleIds = visible.map((item) => item.id);
  const chosen = visible.filter((item) => selected.has(item.id));

  // Une fiche supprimée (par soi ou par un collègue) ne reste pas cochée.
  useEffect(() => {
    setSelected((current) => {
      const alive = new Set(branches.map((item) => item.id));
      const next = new Set([...current].filter((id) => alive.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [branches]);

  const toggle = (id: string): void =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allChosen = visible.length > 0 && chosen.length === visible.length;
  const toggleAll = (): void => setSelected(allChosen ? new Set() : new Set(visibleIds));

  const done = (text: string): void => setFeedback({ tone: "success", text });

  function removeBranch(item: BranchAddress): void {
    if (!window.confirm(`Supprimer la fiche « ${item.nom} » (${item.compagnie}) ?\n\nCette action est définitive.`)) return;
    setFeedback(null);
    startTransition(async () => {
      const result = await deleteBranchAddressAction({ id: item.id });
      setFeedback(result.success ? { tone: "success", text: `La fiche « ${item.nom} » est supprimée.` } : { tone: "error", text: result.error });
    });
  }

  function removeEms(item: EmsContact): void {
    if (!window.confirm(`Supprimer le contact « ${item.nom} » ?\n\nCette action est définitive.`)) return;
    setFeedback(null);
    startTransition(async () => {
      const result = await deleteEmsContactAction({ id: item.id });
      setFeedback(result.success ? { tone: "success", text: `Le contact « ${item.nom} » est supprimé.` } : { tone: "error", text: result.error });
    });
  }

  const printAll = envelopeHref(visibleIds);
  const printChosen = envelopeHref(chosen.map((item) => item.id));
  const bordereauChosen = bordereauPreviewHref(chosen.map((item) => item.id));
  const actionLink = "inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline";

  return (
    <>
      {feedback ? (
        <Notice tone={feedback.tone} className="mb-4">
          {feedback.text}
        </Notice>
      ) : null}
      {canEdit && !persisted ? (
        <Notice tone="info" className="mb-4">
          Ces adresses sont la liste de départ (reprise du fichier Excel). La première modification les enregistre.
        </Notice>
      ) : null}

      <section aria-labelledby="adresses-title">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="adresses-title" className="text-lg font-semibold">
              Adresses des partenaires
            </h2>
            <p className="text-sm text-muted-foreground">Succursales CAAR et CAAT à qui l&apos;on envoie les originaux des factures.</p>
          </div>
          {canEdit ? (
            <Button type="button" onClick={() => setDialogs((current) => ({ ...current, branch: "new" }))}>
              <Plus />
              Ajouter une succursale
            </Button>
          ) : null}
        </div>

        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher (nom, ville, téléphone, contact…)" aria-label="Rechercher une succursale" className="pl-9" />
          </div>
          <div className="sm:w-60">
            <NativeSelect value={company} onChange={(event) => setCompany(event.target.value === "CAAR" ? "CAAR" : event.target.value === "CAAT" ? "CAAT" : "")} aria-label="Filtrer par compagnie">
              <option value="">Toutes les compagnies</option>
              {COURRIER_COMPANIES.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </NativeSelect>
          </div>
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-2">
          {chosen.length > 0 ? (
            <>
              <Link href={printChosen} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: "outline", size: "sm" })}>
                <Printer />
                Imprimer la sélection ({chosen.length})
              </Link>
              <Link href={bordereauChosen} className={buttonVariants({ variant: "violet", size: "sm" })}>
                <FileText />
                Bordereau d&apos;envoi ({chosen.length})
              </Link>
            </>
          ) : null}
          {visible.length > 0 ? (
            <Link href={printAll} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: "outline", size: "sm" })}>
              <Printer />
              Imprimer toutes ({visible.length}) : une étiquette par page
            </Link>
          ) : null}
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {visible.length} fiche(s) sur {branches.length}
          </p>
        </div>

        {visible.length === 0 ? (
          <StateMessage kind="empty" title={branches.length === 0 ? "Aucune succursale enregistrée" : "Aucune succursale ne correspond"} message={branches.length === 0 ? "Ajoutez la première succursale avec le bouton ci-dessus." : "Essayez une autre recherche ou une autre compagnie."} />
        ) : (
          <>
            <div className="hidden overflow-x-auto rounded-lg border bg-card md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox checked={allChosen} onChange={toggleAll} aria-label="Tout sélectionner pour l'impression" />
                    </TableHead>
                    <TableHead>Compagnie</TableHead>
                    <TableHead>Succursale</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead>Téléphone(s)</TableHead>
                    <TableHead>Adresse</TableHead>
                    <TableHead>Remarque</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        <Checkbox checked={selected.has(item.id)} onChange={() => toggle(item.id)} aria-label={`Sélectionner ${item.nom} pour l'impression`} />
                      </TableCell>
                      <TableCell>
                        <Badge variant={item.compagnie === "CAAR" ? "default" : "accent"}>{item.compagnie}</Badge>
                      </TableCell>
                      <TableCell className="font-medium">{item.nom}</TableCell>
                      <TableCell>{item.contact || <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell>{item.telephones || <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell className="min-w-56">{item.adresse}</TableCell>
                      <TableCell className="min-w-32 text-muted-foreground">{item.remarque}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap justify-end gap-x-3 gap-y-1">
                          <Link href={envelopeHref([item.id])} target="_blank" rel="noopener noreferrer" className={actionLink}>
                            <Printer className="size-3.5" aria-hidden />
                            Imprimer l&apos;enveloppe
                          </Link>
                          <Link href={bordereauPreviewHref([item.id])} className={actionLink}>
                            <FileText className="size-3.5" aria-hidden />
                            Bordereau
                          </Link>
                          {canEdit ? (
                            <>
                              <button type="button" className={actionLink} onClick={() => setDialogs((current) => ({ ...current, branch: item }))}>
                                <Pencil className="size-3.5" aria-hidden />
                                Modifier
                              </button>
                              <button type="button" className={cn(actionLink, "text-destructive")} onClick={() => removeBranch(item)} disabled={pending}>
                                <Trash2 className="size-3.5" aria-hidden />
                                Supprimer
                              </button>
                            </>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <ul className="flex flex-col gap-3 md:hidden">
              {visible.map((item) => (
                <li key={item.id} className="rounded-lg border bg-card p-3">
                  <div className="flex items-start gap-3">
                    <Checkbox checked={selected.has(item.id)} onChange={() => toggle(item.id)} aria-label={`Sélectionner ${item.nom} pour l'impression`} className="mt-1" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={item.compagnie === "CAAR" ? "default" : "accent"}>{item.compagnie}</Badge>
                        <p className="font-semibold">{item.nom}</p>
                      </div>
                      <p className="mt-1 text-sm">{item.adresse}</p>
                      <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-sm">
                        <dt className="text-muted-foreground">Téléphone</dt>
                        <dd>{item.telephones || "—"}</dd>
                        {item.contact ? (
                          <>
                            <dt className="text-muted-foreground">Contact</dt>
                            <dd>{item.contact}</dd>
                          </>
                        ) : null}
                        {item.remarque ? (
                          <>
                            <dt className="text-muted-foreground">Remarque</dt>
                            <dd>{item.remarque}</dd>
                          </>
                        ) : null}
                      </dl>
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
                        <Link href={envelopeHref([item.id])} target="_blank" rel="noopener noreferrer" className={cn(actionLink, "text-sm")}>
                          <Printer className="size-4" aria-hidden />
                          Imprimer l&apos;enveloppe
                        </Link>
                        <Link href={bordereauPreviewHref([item.id])} className={cn(actionLink, "text-sm")}>
                          <FileText className="size-4" aria-hidden />
                          Bordereau
                        </Link>
                        {canEdit ? (
                          <>
                            <button type="button" className={cn(actionLink, "text-sm")} onClick={() => setDialogs((current) => ({ ...current, branch: item }))}>
                              <Pencil className="size-4" aria-hidden />
                              Modifier
                            </button>
                            <button type="button" className={cn(actionLink, "text-sm text-destructive")} onClick={() => removeBranch(item)} disabled={pending}>
                              <Trash2 className="size-4" aria-hidden />
                              Supprimer
                            </button>
                          </>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section aria-labelledby="ems-list-title" className="mt-10">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="ems-list-title" className="text-lg font-semibold">
              Prestataire de courrier : {emsSociete}
            </h2>
            <p className="text-sm text-muted-foreground">Personnes à joindre pour le ramassage et les réclamations.</p>
          </div>
          {canEdit ? (
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => setDialogs((current) => ({ ...current, societe: true }))}>
                <Pencil />
                Nom de la société
              </Button>
              <Button type="button" onClick={() => setDialogs((current) => ({ ...current, ems: "new" }))}>
                <Plus />
                Ajouter un contact
              </Button>
            </div>
          ) : null}
        </div>
        {emsContacts.length === 0 ? (
          <StateMessage kind="empty" title="Aucun contact enregistré" message="Ajoutez le ramasseur et la personne à joindre pour les réclamations." />
        ) : (
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {emsContacts.map((item) => (
              <li key={item.id} className="rounded-lg border bg-card p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold">{item.nom}</p>
                  <Badge variant={item.role === "RAMASSEUR" ? "success" : "warning"}>{EMS_ROLE_LABELS[item.role]}</Badge>
                </div>
                <p className="mt-1 text-sm">
                  <PhoneLink phone={item.telephone} />
                </p>
                {item.email ? (
                  <p className="mt-1 text-sm">
                    <MailLink email={item.email} />
                  </p>
                ) : null}
                {item.remarque ? <p className="mt-1 text-sm text-muted-foreground">{item.remarque}</p> : null}
                {canEdit ? (
                  <div className="mt-2 flex gap-4">
                    <button type="button" className={cn(actionLink, "text-sm")} onClick={() => setDialogs((current) => ({ ...current, ems: item }))}>
                      <Pencil className="size-4" aria-hidden />
                      Modifier
                    </button>
                    <button type="button" className={cn(actionLink, "text-sm text-destructive")} onClick={() => removeEms(item)} disabled={pending}>
                      <Trash2 className="size-4" aria-hidden />
                      Supprimer
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <BranchDialog target={dialogs.branch} defaultCompany={company || "CAAR"} onClose={() => setDialogs((current) => ({ ...current, branch: null }))} onSaved={done} />
      <EmsContactDialog target={dialogs.ems} onClose={() => setDialogs((current) => ({ ...current, ems: null }))} onSaved={done} />
      <EmsSocieteDialog open={dialogs.societe} current={emsSociete} onClose={() => setDialogs((current) => ({ ...current, societe: false }))} onSaved={done} />
    </>
  );
}
