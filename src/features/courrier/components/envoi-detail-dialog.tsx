"use client";

import { useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { Printer } from "lucide-react";
import { cancelEnvoiAction, updateEnvoiAction } from "@/app/actions/envoi-actions";
import { Notice } from "@/components/common/notice";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { algiersDateTime } from "@/features/courrier/lib/envois";
import { envoiCancelSchema, envoiUpdateSchema } from "@/features/courrier/schemas";
import { ENVOI_STATUT_LABELS, type Envoi, type EnvoiStatut } from "@/features/courrier/types";
import { formatDate } from "@/utils/format";

/** Variante d'affichage d'un statut. */
export const STATUT_VARIANT: Readonly<Record<EnvoiStatut, "warning" | "success" | "muted">> = { ETABLI: "warning", RAMASSE: "success", ANNULE: "muted" };

/** Propriétés du panneau de détail d'un bordereau. */
export interface EnvoiDetailDialogProps {
  /** Bordereau affiché, null pour fermer le panneau. */
  envoi: Envoi | null;
  canEdit: boolean;
  today: string;
  onClose: () => void;
  onDone: (message: string) => void;
}

/** Détail d'un bordereau : toutes les lignes, modification (date de ramassage, ramasseur, remarque), réimpression à l'identique et annulation avec motif. */
export function EnvoiDetailDialog({ envoi, canEdit, today, onClose, onDone }: Readonly<EnvoiDetailDialogProps>): React.JSX.Element {
  return (
    <Dialog open={envoi !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-w-3xl">{envoi !== null ? <DetailBody key={envoi.numero} envoi={envoi} canEdit={canEdit} today={today} onClose={onClose} onDone={onDone} /> : null}</DialogContent>
    </Dialog>
  );
}

function DetailBody({ envoi, canEdit, today, onClose, onDone }: Readonly<Omit<EnvoiDetailDialogProps, "envoi"> & { envoi: Envoi }>): React.JSX.Element {
  const locked = envoi.statut === "ANNULE";
  const [ramasseLe, setRamasseLe] = useState(envoi.ramasseLe);
  const [ramasseur, setRamasseur] = useState(envoi.ramasseur);
  const [remarque, setRemarque] = useState(envoi.remarque);
  const [motif, setMotif] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const payload = { numero: envoi.numero, ramasseLe, ramasseur, remarque };
    const parsed = envoiUpdateSchema.safeParse(payload);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Données invalides.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await updateEnvoiAction(payload);
      if (result.success) {
        onDone(`Bordereau ${envoi.numero} mis à jour.`);
        onClose();
      } else setError(result.error);
    });
  }

  function cancel(): void {
    const payload = { numero: envoi.numero, motif };
    const parsed = envoiCancelSchema.safeParse(payload);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Motif invalide.");
      return;
    }
    if (!window.confirm(`Annuler le bordereau ${envoi.numero} ?\n\nIl restera dans l'historique, barré, avec son motif.`)) return;
    setError(null);
    startTransition(async () => {
      const result = await cancelEnvoiAction(payload);
      if (result.success) {
        onDone(`Bordereau ${envoi.numero} annulé.`);
        onClose();
      } else setError(result.error);
    });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex flex-wrap items-center gap-2">
          Bordereau {envoi.numero}
          <Badge variant={STATUT_VARIANT[envoi.statut]}>{ENVOI_STATUT_LABELS[envoi.statut]}</Badge>
        </DialogTitle>
        <DialogDescription>
          Créé le {algiersDateTime(envoi.creeLe)} par {envoi.creePar || "—"} · date du bordereau {formatDate(envoi.date)} · {envoi.total} pli(s)
        </DialogDescription>
      </DialogHeader>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="p-2">Désignation</th>
              <th className="p-2 text-right">Qnt</th>
              <th className="p-2">Destination</th>
              <th className="p-2">Observation</th>
            </tr>
          </thead>
          <tbody>
            {envoi.lignes.map((line, index) => (
              <tr key={`${index}-${line.designation}`} className="border-b last:border-b-0">
                <td className="p-2 font-medium">{line.designation}</td>
                <td className="p-2 text-right tabular-nums">{line.qnt}</td>
                <td className="p-2">{line.destination || "—"}</td>
                <td className="p-2">{line.observation || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {locked ? (
        <Notice tone="warning">
          Annulé le {algiersDateTime(envoi.annuleLe)} par {envoi.annulePar || "—"}. Motif : {envoi.motifAnnulation || "—"}
        </Notice>
      ) : null}
      <form onSubmit={save} noValidate className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field id="env-ramasse" label="Date de ramassage" hint="Date à laquelle EMS a réellement ramassé. Vide tant qu'elle n'est pas connue.">
          <Input id="env-ramasse" type="date" value={ramasseLe} max={today} min={envoi.date || undefined} onChange={(event) => setRamasseLe(event.target.value)} disabled={!canEdit || locked || pending} />
        </Field>
        <Field id="env-ramasseur" label="Ramasseur">
          <Input id="env-ramasseur" value={ramasseur} onChange={(event) => setRamasseur(event.target.value)} maxLength={80} disabled={!canEdit || locked || pending} autoComplete="off" />
        </Field>
        <Field id="env-remarque" label="Remarque" className="sm:col-span-2">
          <Input id="env-remarque" value={remarque} onChange={(event) => setRemarque(event.target.value)} maxLength={300} disabled={!canEdit || locked || pending} autoComplete="off" />
        </Field>
        {canEdit && !locked ? (
          <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
            <Button type="submit" disabled={pending}>
              {pending ? "Enregistrement…" : "Enregistrer les modifications"}
            </Button>
            {ramasseLe !== today ? (
              <Button type="button" variant="outline" onClick={() => setRamasseLe(today)} disabled={pending}>
                Ramassé aujourd&apos;hui
              </Button>
            ) : null}
          </div>
        ) : null}
      </form>
      {canEdit && !locked ? (
        <div className="flex flex-col gap-2 rounded-md border border-destructive/30 p-3 sm:flex-row sm:items-end">
          <Field id="env-motif" label="Annuler ce bordereau (motif obligatoire)" className="flex-1">
            <Input id="env-motif" value={motif} onChange={(event) => setMotif(event.target.value)} maxLength={300} disabled={pending} autoComplete="off" placeholder="Ex. : envoi reporté, erreur de succursale" />
          </Field>
          <Button type="button" variant="destructive" onClick={cancel} disabled={pending}>
            Annuler le bordereau
          </Button>
        </div>
      ) : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      <DialogFooter>
        <Link href={`/imprimer/bordereau?no=${encodeURIComponent(envoi.numero)}&copie=1`} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: "outline" })}>
          <Printer />
          Réimprimer (duplicata)
        </Link>
        <Button type="button" variant="outline" onClick={onClose}>
          Fermer
        </Button>
      </DialogFooter>
    </>
  );
}
