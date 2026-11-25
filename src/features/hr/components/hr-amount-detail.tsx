"use client";

import { useEffect, useState, useTransition } from "react";
import { Link2, Link2Off, Pencil, Trash2 } from "lucide-react";
import { assignHrEntryAction, deleteHrEntryAction, hrEntryDetailAction, unlinkHrEntryAction } from "@/app/actions/hr-actions";
import { Notice } from "@/components/common/notice";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { HrEntryDialog } from "@/features/hr/components/hr-entry-dialog";
import type { HrDetailDTO, HrEntryDTO, HrLineDTO } from "@/features/hr/types";
import { cn } from "@/utils/cn";
import { formatDA, formatDate, formatDateTime } from "@/utils/format";

/** Propriétés du montant cliquable. */
export interface HrAmountDetailProps {
  entry: HrEntryDTO;
  beneficiaries: string[];
  today: string;
}

function LineRow({ line, children }: Readonly<{ line: HrLineDTO; children?: React.ReactNode }>): React.JSX.Element {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-sm">
      <div className="min-w-0 flex-1">
        <p className="font-medium tabular-nums">
          {formatDate(line.date)} · {line.sens === "CREDIT" ? "+" : "−"} {formatDA(line.montant)}
          {line.ecart !== null && !line.exact ? <span className="ml-2 text-xs text-destructive">écart {line.ecart > 0 ? "+" : "−"} {formatDA(Math.abs(line.ecart))}</span> : null}
          {line.exact ? (
            <Badge variant="success" className="ml-2">
              Montant identique
            </Badge>
          ) : null}
        </p>
        <p className="truncate text-xs text-muted-foreground" title={line.libelle}>
          {line.libelle}
          {line.numero ? ` · n° ${line.numero}` : ""}
        </p>
      </div>
      {children}
    </li>
  );
}

/**
 * Montant d'une écriture RH cliquable : ouvre le détail (champs, relevé lié, propositions d'affectation, écritures voisines, historique)
 * avec les actions modifier / corriger, supprimer, affecter au relevé, détacher.
 */
export function HrAmountDetail({ entry, beneficiaries, today }: Readonly<HrAmountDetailProps>): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [detail, setDetail] = useState<HrDetailDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [alignAmount, setAlignAmount] = useState(false);
  const [alignDate, setAlignDate] = useState(false);
  const [pending, startTransition] = useTransition();

  function load(): void {
    startTransition(async () => {
      const result = await hrEntryDetailAction({ id: entry.id });
      if (result.success) setDetail(result.data);
      else setError(result.error);
    });
  }

  useEffect(() => {
    if (open) {
      setError(null);
      setMessage(null);
      setConfirmDelete(false);
      load();
    }
    // Rechargé à chaque ouverture et quand l'écriture change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, entry.id, entry.montant]);

  function assign(lineId: string): void {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await assignHrEntryAction({ id: entry.id, lineId, alignerMontant: alignAmount, alignerDate: alignDate });
      if (result.success) {
        setMessage("Écriture affectée à la ligne du relevé.");
        setAlignAmount(false);
        setAlignDate(false);
        load();
      } else setError(result.error);
    });
  }

  function unlink(): void {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await unlinkHrEntryAction({ id: entry.id });
      if (result.success) {
        setMessage(`${result.data.lines} ligne(s) du relevé détachée(s) : elles repassent « à traiter ».`);
        load();
      } else setError(result.error);
    });
  }

  function remove(): void {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    startTransition(async () => {
      const result = await deleteHrEntryAction({ id: entry.id });
      if (result.success) setOpen(false);
      else setError(result.error);
    });
  }

  const current = detail?.entry ?? entry;
  const cell = (label: string, value: string): React.JSX.Element => (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value || "—"}</dd>
    </div>
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Voir le détail, modifier, corriger, affecter ou supprimer"
        aria-label={`Détail de l'écriture ${entry.beneficiaire} ${formatDA(entry.montant)}`}
        className={cn("rounded px-1 font-medium underline decoration-dotted underline-offset-4 hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", entry.sens === "RETOUR" && "text-destructive")}
      >
        {entry.sens === "RETOUR" ? "− " : ""}
        {formatDA(entry.montant)}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="tabular-nums">
              {current.sens === "RETOUR" ? "− " : ""}
              {formatDA(current.montant)} · {current.nature}
            </DialogTitle>
            <DialogDescription>{current.beneficiaire || "Sans bénéficiaire"}</DialogDescription>
          </DialogHeader>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            {cell("Date de paiement", current.date ? formatDate(current.date) : "Non renseignée")}
            {cell("Mois concerné", current.mois)}
            {cell("Type", current.sens === "RETOUR" ? "Retour / remboursement" : "Paiement")}
            {cell("Règlement", current.mode === "CHEQUE" ? `Chèque ${current.cheque}` : current.mode === "VIRMT" ? "Virement" : "")}
            {cell("Banque", current.banque)}
            {cell("Saisi par", current.par)}
          </dl>
          {current.libelle ? <p className="rounded-md bg-muted/50 p-2 text-sm">{current.libelle}</p> : null}
          {error ? <Notice tone="error">{error}</Notice> : null}
          {message ? <Notice tone="success">{message}</Notice> : null}
          {!detail && pending ? <p className="text-sm text-muted-foreground">Chargement du détail…</p> : null}
          {detail ? (
            <>
              <section aria-label="Relevé bancaire" className="grid gap-2">
                <h3 className="text-sm font-semibold">Relevé bancaire</h3>
                {!detail.releveVisible ? (
                  <p className="text-sm text-muted-foreground">Votre profil n'a pas accès au relevé bancaire.</p>
                ) : detail.linked.length > 0 ? (
                  <>
                    <ul className="grid gap-2">
                      {detail.linked.map((line) => (
                        <LineRow key={line.id} line={line} />
                      ))}
                    </ul>
                    {detail.linked.some((line) => !line.exact) && detail.canEdit ? (
                      <Notice tone="warning">Le montant du relevé diffère de celui de l'écriture. « Modifier / corriger » permet de le rectifier.</Notice>
                    ) : null}
                    {detail.canAssign ? (
                      <div>
                        <Button type="button" variant="outline" size="sm" onClick={unlink} disabled={pending}>
                          <Link2Off />
                          Détacher du relevé
                        </Button>
                      </div>
                    ) : null}
                  </>
                ) : detail.candidates.length > 0 ? (
                  <>
                    <p className="text-sm text-muted-foreground">Aucune ligne liée. Lignes libres du relevé qui pourraient correspondre :</p>
                    {detail.canAssign ? (
                      <div className="flex flex-wrap gap-4 text-sm">
                        <label className="flex items-center gap-2">
                          <Checkbox checked={alignAmount} onChange={(event) => setAlignAmount(event.target.checked)} />
                          Aligner le montant sur le relevé
                        </label>
                        <label className="flex items-center gap-2">
                          <Checkbox checked={alignDate} onChange={(event) => setAlignDate(event.target.checked)} />
                          Aligner la date sur le relevé
                        </label>
                      </div>
                    ) : null}
                    <ul className="grid gap-2">
                      {detail.candidates.map((line) => (
                        <LineRow key={line.id} line={line}>
                          {detail.canAssign ? (
                            <Button type="button" size="sm" onClick={() => assign(line.id)} disabled={pending}>
                              <Link2 />
                              Affecter
                            </Button>
                          ) : null}
                        </LineRow>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">Aucune ligne du relevé liée, et aucune ligne libre proche de ce montant.</p>
                )}
              </section>
              {detail.similar.length > 0 ? (
                <section aria-label="Écritures au même montant" className="grid gap-1">
                  <h3 className="text-sm font-semibold">Autres écritures au même montant</h3>
                  <ul className="grid gap-1 text-sm text-muted-foreground">
                    {detail.similar.map((item) => (
                      <li key={item.id}>
                        {item.date ? formatDate(item.date) : "sans date"} · {item.nature} · {item.beneficiaire || "—"} · {formatDA(item.montant)}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              <p className="text-xs text-muted-foreground">
                {detail.creeLe ? `Créée par ${detail.creePar || "—"} le ${formatDateTime(detail.creeLe)}. ` : "Reprise de l'ancien suivi. "}
                {detail.majLe ? `Dernière modification par ${detail.majPar || "—"} le ${formatDateTime(detail.majLe)}.` : ""}
              </p>
              {detail.canEdit ? (
                <div className="flex flex-wrap justify-between gap-2 border-t pt-3">
                  <Button type="button" variant="destructive" onClick={remove} disabled={pending}>
                    <Trash2 />
                    {confirmDelete ? "Confirmer la suppression" : "Supprimer"}
                  </Button>
                  <Button type="button" onClick={() => setEditing(true)} disabled={pending}>
                    <Pencil />
                    Modifier / corriger
                  </Button>
                </div>
              ) : null}
            </>
          ) : null}
        </DialogContent>
      </Dialog>
      <HrEntryDialog
        entry={current}
        beneficiaries={beneficiaries}
        today={today}
        open={editing}
        onOpenChange={(value) => {
          setEditing(value);
          if (!value && open) load();
        }}
      />
    </>
  );
}
