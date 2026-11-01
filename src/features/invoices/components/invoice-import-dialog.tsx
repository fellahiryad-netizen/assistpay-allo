"use client";

import { useState, useTransition } from "react";
import { Upload } from "lucide-react";
import { applyInvoiceImportAction, previewInvoiceImportAction } from "@/app/actions/invoice-actions";
import { FileDrop } from "@/components/common/file-drop";
import { Notice } from "@/components/common/notice";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { InvoiceImportPlan } from "@/features/invoices/services/invoice-import";
import { formatDA, formatDate } from "@/utils/format";

function Kpi({ label, value }: Readonly<{ label: string; value: number }>): React.JSX.Element {
  return (
    <div className="rounded-md border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

/**
 * Import du fichier de facturation : classeur de suivi (mêmes colonnes que l'export) ou classeur de facturation
 * partenaires (une feuille par facture). Aperçu d'abord, rien n'est enregistré avant « Appliquer ».
 */
export function InvoiceImportDialog(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [plan, setPlan] = useState<InvoiceImportPlan | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [done, setDone] = useState<{ created: number; updated: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function reset(): void {
    setFile(null);
    setPlan(null);
    setChecked(new Set());
    setDone(null);
    setError(null);
  }

  function choose(next: File): void {
    setFile(next);
    setError(null);
    const form = new FormData();
    form.set("file", next);
    startTransition(async () => {
      const result = await previewInvoiceImportAction(form);
      if (!result.success) {
        setError(result.error);
        return;
      }
      setPlan(result.data);
      if (result.data.kind === "partenaires") setChecked(new Set(result.data.items.filter((entry) => entry.on).map((entry) => entry.item.sheet)));
    });
  }

  const total = plan ? (plan.kind === "suivi" ? plan.add.length + plan.updates.length : checked.size) : 0;

  function apply(): void {
    if (!file || !plan) return;
    const form = new FormData();
    form.set("file", file);
    if (plan.kind === "partenaires") form.set("selection", JSON.stringify([...checked]));
    startTransition(async () => {
      const result = await applyInvoiceImportAction(form);
      if (result.success) setDone(result.data);
      else setError(result.error);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        <Upload />
        Importer le fichier de facturation
      </Button>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Importer le fichier de facturation</DialogTitle>
          <DialogDescription>
            Deux fichiers sont reconnus automatiquement : le classeur de suivi (mêmes colonnes que l&apos;export Excel) et le classeur de facturation des partenaires
            (une feuille par facture : GAM, TRUST, MLA, CAAT, CAAR, TDA). Une facture n&apos;est jamais créée deux fois ; les salaires, CNAS et G50 sont écartés.
          </DialogDescription>
        </DialogHeader>
        {error ? <Notice tone="error">{error}</Notice> : null}
        {done ? (
          <Notice tone="success">
            {done.created} facture(s) ajoutée(s), {done.updated} mise(s) à jour. Les totaux sont à jour.
          </Notice>
        ) : plan?.kind === "suivi" ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">Feuille lue : « {plan.sheet} »</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Kpi label="Nouvelles factures" value={plan.add.length} />
              <Kpi label="Mises à jour" value={plan.updates.length} />
              <Kpi label="Inchangées" value={plan.same} />
              <Kpi label="Lignes de paie écartées" value={plan.payroll} />
            </div>
            {plan.conflicts ? <Notice tone="info">{plan.conflicts} facture(s) déjà réglée(s) ici mais « en attente » dans le fichier : laissées réglées.</Notice> : null}
            {plan.refused ? <Notice tone="warning">{plan.refused} ligne(s) ignorée(s) : vous n&apos;avez pas le droit de modifier ce sens (crédit ou débit).</Notice> : null}
            <ul className="max-h-64 divide-y overflow-y-auto rounded-md border text-sm">
              {plan.add.slice(0, 60).map((row, index) => (
                <li key={`a-${index}`} className="flex justify-between gap-2 px-3 py-1.5">
                  <span className="truncate">
                    Nouvelle : {[row.sens === "CREDIT" ? "Crédit" : "Débit", row.tiers || row.categorie, row.numero].filter(Boolean).join(" – ")}
                  </span>
                  <b className="tabular-nums">{formatDA(row.montant)}</b>
                </li>
              ))}
              {plan.updates.slice(0, 60).map((update) => (
                <li key={`u-${update.id}`} className="flex justify-between gap-2 px-3 py-1.5">
                  <span className="truncate">
                    Mise à jour : {update.tiers} {update.numero} ({update.changes.join(", ")})
                  </span>
                  <b className="tabular-nums">{formatDA(update.montant)}</b>
                </li>
              ))}
            </ul>
          </div>
        ) : plan?.kind === "partenaires" ? (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Kpi label="Factures lues" value={plan.read} />
              <Kpi label="Identiques au suivi" value={plan.same} />
              <Kpi label="Montant modifié" value={plan.items.filter((entry) => entry.kind === "maj").length} />
              <Kpi label="Absentes du suivi" value={plan.items.filter((entry) => entry.kind === "new").length} />
            </div>
            {plan.items.length === 0 ? (
              <Notice tone="success">Toutes les factures du classeur sont déjà dans le suivi, avec les mêmes montants.</Notice>
            ) : (
              <div className="max-h-72 overflow-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left">
                      <th className="w-8 p-2" />
                      <th className="p-2">N° facture</th>
                      <th className="p-2">Date</th>
                      <th className="p-2">Client</th>
                      <th className="p-2 text-right">Suivi</th>
                      <th className="p-2 text-right">Fichier</th>
                      <th className="p-2">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.items.map((entry) => (
                      <tr key={entry.item.sheet} className="border-t">
                        <td className="p-2">
                          <input
                            type="checkbox"
                            aria-label={`Appliquer ${entry.item.num}`}
                            checked={checked.has(entry.item.sheet)}
                            onChange={(event) => {
                              const next = new Set(checked);
                              if (event.target.checked) next.add(entry.item.sheet);
                              else next.delete(entry.item.sheet);
                              setChecked(next);
                            }}
                          />
                        </td>
                        <td className="whitespace-nowrap p-2">{entry.item.num}</td>
                        <td className="whitespace-nowrap p-2">{formatDate(entry.item.date || null)}</td>
                        <td className="max-w-40 truncate p-2">{[entry.item.client, entry.item.succ].filter(Boolean).join(" – ")}</td>
                        <td className="whitespace-nowrap p-2 text-right tabular-nums">{entry.currentAmount === null ? "—" : formatDA(entry.currentAmount)}</td>
                        <td className="whitespace-nowrap p-2 text-right tabular-nums">{formatDA(entry.item.ttc)}</td>
                        <td className="p-2">
                          {entry.kind === "new" ? "Ajouter (en attente)" : "Corriger le montant"}
                          {entry.warning ? <span className="block text-xs text-destructive">⚠ {entry.warning}</span> : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {plan.withoutTotal ? <p className="text-xs text-muted-foreground">{plan.withoutTotal} feuille(s) sans total TTC lisible ignorée(s).</p> : null}
          </div>
        ) : (
          <FileDrop label={pending ? "Lecture du fichier…" : "Déposez le fichier de facturation"} hint="Excel (.xlsx, .xlsm) ou CSV, 4 Mo au maximum" disabled={pending} onFile={choose} />
        )}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Fermer
          </Button>
          {plan && !done ? (
            <Button type="button" onClick={apply} disabled={pending || total === 0}>
              Appliquer ({total})
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
