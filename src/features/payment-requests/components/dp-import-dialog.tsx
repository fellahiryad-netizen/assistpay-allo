"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Upload } from "lucide-react";
import { applyRequestImportAction, previewRequestImportAction } from "@/app/actions/payment-request-actions";
import { FileDrop } from "@/components/common/file-drop";
import { Notice } from "@/components/common/notice";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { DpImportPlan } from "@/features/payment-requests/types";
import { formatDA } from "@/utils/format";

/** Import du classeur des demandes de paiement (une feuille par demande). */
export function DpImportDialog(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [plan, setPlan] = useState<DpImportPlan | null>(null);
  const [done, setDone] = useState<{ created: string[]; updated: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function reset(): void {
    setFile(null);
    setPlan(null);
    setDone(null);
    setError(null);
  }

  function choose(next: File): void {
    setFile(next);
    setError(null);
    const form = new FormData();
    form.set("file", next);
    startTransition(async () => {
      const result = await previewRequestImportAction(form);
      if (result.success) setPlan(result.data);
      else setError(result.error);
    });
  }

  function apply(): void {
    if (!file) return;
    const form = new FormData();
    form.set("file", file);
    startTransition(async () => {
      const result = await applyRequestImportAction(form);
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
        Importer le fichier des demandes
      </Button>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Importer des demandes de paiement</DialogTitle>
          <DialogDescription>
            Classeur habituel : une feuille par demande (n° en E4, nom et prénom du bénéficiaire, montant, pièces jointes, produit coché en bas).
          </DialogDescription>
        </DialogHeader>
        {error ? <Notice tone="error">{error}</Notice> : null}
        {done ? (
          <>
            <Notice tone="success">
              {done.created.length} nouvelle(s) demande(s) importée(s), {done.updated} modifiée(s).
            </Notice>
            {done.created.length ? (
              <Link href={`/virements/nouveau?dp=${done.created.join(",")}`} className={buttonVariants()}>
                Préparer l&apos;état des virements de ces {done.created.length} demandes
              </Link>
            ) : null}
          </>
        ) : plan ? (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                ["Feuilles lues", plan.sheets],
                ["Nouvelles", plan.add.length],
                ["Modifiées", plan.update.length],
                ["Inchangées", plan.unchanged],
              ].map(([label, value]) => (
                <div key={String(label)} className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="text-xl font-semibold tabular-nums">{value}</p>
                </div>
              ))}
            </div>
            {plan.deduced || plan.unknownProduct ? (
              <Notice tone="info">
                {plan.deduced ? `${plan.deduced} demande(s) sans case cochée : produit déduit de l'historique du prestataire. ` : ""}
                {plan.unknownProduct ? `${plan.unknownProduct} demande(s) sans produit connu, à vérifier.` : ""}
              </Notice>
            ) : null}
            <ul className="max-h-64 divide-y overflow-y-auto rounded-md border text-sm">
              {plan.add.map((item) => (
                <li key={`a-${item.ref}`} className="flex justify-between gap-2 px-3 py-1.5">
                  <span className="truncate">
                    {item.ref} – {item.beneficiaire} · {item.produit || "produit ?"}
                    {item.produitDeduit ? " (déduit)" : ""}
                  </span>
                  <b className="tabular-nums">{formatDA(item.montant)}</b>
                </li>
              ))}
              {plan.update.map((item) => (
                <li key={`u-${item.id}`} className="flex justify-between gap-2 px-3 py-1.5">
                  <span className="truncate">Modifiée : {item.ref} – {item.request.beneficiaire}</span>
                  <b className="tabular-nums">{formatDA(item.request.montant)}</b>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <FileDrop label={pending ? "Lecture du fichier…" : "Déposez le classeur des demandes"} disabled={pending} onFile={choose} />
        )}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Fermer
          </Button>
          {plan && !done ? (
            <Button type="button" onClick={apply} disabled={pending || plan.add.length + plan.update.length === 0}>
              Appliquer ({plan.add.length + plan.update.length})
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
