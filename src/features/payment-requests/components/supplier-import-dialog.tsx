"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Download, Upload } from "lucide-react";
import { applySupplierImportAction, previewSupplierImportAction } from "@/app/actions/payment-request-actions";
import { FileDrop } from "@/components/common/file-drop";
import { Notice } from "@/components/common/notice";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { SupplierPlan } from "@/features/payment-requests/services/supplier-import";
import { formatDA } from "@/utils/format";

/**
 * Import en masse des factures fournisseurs (canevas Excel) : chaque facture est créée en Débit et ses demandes de
 * paiement sont créées à la suite. Aperçu d'abord, rien n'est enregistré avant « Appliquer ».
 */
export function SupplierImportDialog(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [plan, setPlan] = useState<SupplierPlan | null>(null);
  const [done, setDone] = useState<{ invoices: number; requests: string[] } | null>(null);
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
      const result = await previewSupplierImportAction(form);
      if (result.success) setPlan(result.data);
      else setError(result.error);
    });
  }

  function apply(): void {
    if (!file) return;
    const form = new FormData();
    form.set("file", file);
    startTransition(async () => {
      const result = await applySupplierImportAction(form);
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
        Importer des factures fournisseurs (canevas)
      </Button>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Importer des factures fournisseurs (canevas)</DialogTitle>
          <DialogDescription>
            Une ligne par facture déposée. Chaque facture est créée en Débit (en attente, déposée aujourd&apos;hui) et sa demande de paiement est créée
            automatiquement, à la suite de la numérotation. Le chèque se saisit plus tard avec « Marquer réglé ». Les factures déjà enregistrées sont ignorées.
          </DialogDescription>
        </DialogHeader>
        <a href="/api/demandes/canevas" className={buttonVariants({ variant: "ghost", size: "sm", className: "self-start" })}>
          <Download />
          Télécharger le canevas vierge
        </a>
        {error ? <Notice tone="error">{error}</Notice> : null}
        {done ? (
          <Notice tone="success">
            {done.invoices} facture(s) créée(s) avec {done.requests.length} demande(s) de paiement ({done.requests.slice(0, 6).join(", ")}
            {done.requests.length > 6 ? "…" : ""}). <Link href="/demandes?filtre=a_valider" className="underline">Voir les demandes à valider</Link>
          </Notice>
        ) : plan ? (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                ["Factures à créer", plan.invoices],
                ["Demandes de paiement", plan.groups.length],
                ["Par chèque", plan.groups.filter((group) => group.mode === "CHEQUE").length],
                ["Déjà enregistrées", plan.duplicates.length],
              ].map(([label, value]) => (
                <div key={String(label)} className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="text-xl font-semibold tabular-nums">{value}</p>
                </div>
              ))}
            </div>
            <p className="text-sm text-muted-foreground">Total TTC à importer : {formatDA(plan.total)}</p>
            <ul className="max-h-64 divide-y overflow-y-auto rounded-md border text-sm">
              {plan.groups.slice(0, 150).map((group, index) => (
                <li key={`${group.benef}-${index}`} className="flex justify-between gap-2 px-3 py-1.5">
                  <span className="truncate">
                    {group.rows.length > 1 ? `Demande groupée (${group.rows.length} factures) : ` : ""}
                    {group.benef} – {group.rows.map((row) => row.facture || "sans n°").join(", ")} – {group.produit}
                    {group.rows.some((row) => row.produitDeduit) ? " (déduit)" : ""} – {group.mode === "CHEQUE" ? "chèque" : "virement"}
                  </span>
                  <b className="tabular-nums">{formatDA(group.total)}</b>
                </li>
              ))}
            </ul>
            {plan.duplicates.length ? (
              <Notice tone="info">
                Ignorées car déjà enregistrées : {plan.duplicates.slice(0, 5).map((item) => `${item.benef} ${item.facture}`.trim()).join(" · ")}
                {plan.duplicates.length > 5 ? " …" : ""}
              </Notice>
            ) : null}
            {plan.errors.length ? (
              <Notice tone="error">
                {plan.errors.slice(0, 8).join(" · ")}
                {plan.errors.length > 8 ? " …" : ""}
              </Notice>
            ) : null}
          </div>
        ) : (
          <FileDrop label={pending ? "Lecture du fichier…" : "Déposez le canevas rempli"} disabled={pending} onFile={choose} />
        )}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Fermer
          </Button>
          {plan && !done ? (
            <Button type="button" onClick={apply} disabled={pending || plan.invoices === 0}>
              Appliquer : {plan.invoices} facture(s) et {plan.groups.length} demande(s)
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
