"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Upload } from "lucide-react";
import { applyGamImportAction, previewGamImportAction } from "@/app/actions/gam-actions";
import { FileDrop } from "@/components/common/file-drop";
import { Notice } from "@/components/common/notice";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { GamCreated, GamImportPreview } from "@/features/billing/services/gam-import";
import { formatDA } from "@/utils/format";

/** Mois précédent (AAAA-MM) d'une date AAAA-MM-JJ : période de facturation proposée. */
function previousMonth(today: string): string {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, "0")}`;
}

/**
 * Import du fichier extrait du système pour BDG GAM : le site sépare lui-même les dossiers conventionnels (N° de sinistre à 10 chiffres)
 * et Takaful (12 chiffres), contrôle le total, puis crée les deux factures globales avec le détail des dossiers.
 */
export function GamImportDialog({ today }: Readonly<{ today: string }>): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<GamImportPreview | null>(null);
  const [created, setCreated] = useState<GamCreated[] | null>(null);
  const [per, setPer] = useState(previousMonth(today));
  const [date, setDate] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function reset(): void {
    setFile(null);
    setPreview(null);
    setCreated(null);
    setError(null);
  }

  function choose(next: File): void {
    setFile(next);
    setPreview(null);
    setError(null);
    const form = new FormData();
    form.set("file", next);
    startTransition(async () => {
      const result = await previewGamImportAction(form);
      if (result.success) setPreview(result.data);
      else setError(result.error);
    });
  }

  function apply(): void {
    if (!file) return;
    const form = new FormData();
    form.set("file", file);
    form.set("per", per);
    form.set("date", date);
    startTransition(async () => {
      const result = await applyGamImportAction(form);
      if (result.success) setCreated(result.data);
      else setError(result.error);
    });
  }

  const blocked = !preview || preview.unknown.length > 0 || (preview.fileTotalHt !== null && !preview.controlOk) || preview.nbConv + preview.nbTakaful === 0;
  const idOf = (kind: GamCreated["kind"]): string | undefined => created?.find((item) => item.kind === kind)?.id;
  const printHref = `/imprimer/factures?ids=${[idOf("CONV"), idOf("TAKAFUL")].filter(Boolean).join(",")}`;
  const detailHref = created ? `/api/bdg/gam-detail?${[idOf("CONV") ? `conv=${idOf("CONV")}` : "", idOf("TAKAFUL") ? `takaful=${idOf("TAKAFUL")}` : ""].filter(Boolean).join("&")}` : "";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <Button type="button" onClick={() => setOpen(true)}>
        <Upload />
        Importer le fichier système GAM
      </Button>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Importer le fichier système BDG GAM</DialogTitle>
          <DialogDescription>
            Déposez l&apos;extraction du système (ex. bill-663). Le site sépare les dossiers conventionnels (N° de sinistre à 10 chiffres) des dossiers Takaful (12 chiffres une fois les lettres et
            symboles retirés), contrôle le total, puis crée les deux factures globales avec le détail des dossiers.
          </DialogDescription>
        </DialogHeader>
        {error ? <Notice tone="error">{error}</Notice> : null}
        {created ? (
          <div className="flex flex-col gap-3">
            <Notice tone="success">{created.length} facture(s) globale(s) créée(s).</Notice>
            <ul className="divide-y rounded-md border text-sm">
              {created.map((item) => (
                <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <span>
                    <b>{item.kind === "CONV" ? "Conventionnelle" : "Takaful"}</b> · {item.num} · {item.nb} dossiers · TTC {formatDA(item.ttc)}
                  </span>
                  <span className="flex gap-2">
                    <Link href={`/facturation/${item.id}`} className={buttonVariants({ size: "sm", variant: "outline" })}>
                      Ouvrir
                    </Link>
                    <Link href={`/imprimer/factures?ids=${item.id}`} target="_blank" className={buttonVariants({ size: "sm" })}>
                      Imprimer
                    </Link>
                  </span>
                </li>
              ))}
            </ul>
            <div className="rounded-md border p-3">
              <p className="mb-2 text-sm font-semibold">Dossier final : factures globales + détail des dossiers (Conventionnelle puis Takaful)</p>
              <div className="flex flex-wrap gap-2">
                <Link href={`${printHref}&entete=papier`} target="_blank" className={buttonVariants()}>
                  Imprimer sur papier à en-tête
                </Link>
                <Link href={`${printHref}&entete=charte`} target="_blank" className={buttonVariants({ variant: "outline" })}>
                  Imprimer avec la charte (logo)
                </Link>
                <a href={detailHref} className={buttonVariants({ variant: "outline" })}>
                  Détail en Excel (CONV et TAKAFUL)
                </a>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <FileDrop label={pending && !preview ? "Lecture du fichier…" : file ? file.name : "Déposez le fichier extrait du système"} hint="Excel (.xlsx) — 4 Mo au maximum" disabled={pending} onFile={choose} />
            {preview ? (
              <>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <div className="rounded-md border p-3">
                    <p className="text-xs text-muted-foreground">Conventionnel</p>
                    <p className="text-xl font-semibold tabular-nums">{preview.nbConv} dossiers</p>
                    <p className="text-sm tabular-nums">{formatDA(preview.convHt)} HT</p>
                  </div>
                  <div className="rounded-md border p-3">
                    <p className="text-xs text-muted-foreground">Takaful</p>
                    <p className="text-xl font-semibold tabular-nums">{preview.nbTakaful} dossiers</p>
                    <p className="text-sm tabular-nums">{formatDA(preview.takafulHt)} HT</p>
                  </div>
                  <div className="rounded-md border p-3">
                    <p className="text-xs text-muted-foreground">Total</p>
                    <p className="text-xl font-semibold tabular-nums">{preview.nbConv + preview.nbTakaful} dossiers</p>
                    <p className="text-sm tabular-nums">{formatDA(preview.totalHt)} HT</p>
                  </div>
                </div>
                {preview.fileTotalHt === null ? (
                  <Notice tone="warning">Le fichier ne donne pas de « Total HT » : le contrôle du total n&apos;a pas pu être fait.</Notice>
                ) : preview.controlOk ? (
                  <Notice tone="success">Total contrôlé : identique au Total HT du fichier ({formatDA(preview.fileTotalHt)}).</Notice>
                ) : (
                  <Notice tone="error">Écart avec le Total HT du fichier ({formatDA(preview.fileTotalHt)}) : import impossible tant qu&apos;il n&apos;est pas expliqué.</Notice>
                )}
                {preview.unknown.length ? (
                  <Notice tone="error">
                    {preview.unknown.length} dossier(s) à vérifier (N° de sinistre ni à 10 ni à 12 chiffres) :{" "}
                    {preview.unknown
                      .slice(0, 8)
                      .map((item) => `${item.dos} (${item.sin || "vide"})`)
                      .join(", ")}
                    .
                  </Notice>
                ) : null}
                {preview.duplicates.length ? (
                  <Notice tone="warning">N° de dossier présents deux fois : {preview.duplicates.map((item) => item.dos).join(", ")}. Ils sont comptés deux fois, vérifiez avant de continuer.</Notice>
                ) : null}
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <label className="flex flex-col gap-1 text-sm">
                    Période de facturation
                    <Input type="month" value={per} onChange={(event) => setPer(event.target.value)} />
                  </label>
                  <label className="flex flex-col gap-1 text-sm">
                    Date des factures
                    <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
                  </label>
                </div>
                <Button type="button" disabled={pending || blocked || !per || !date} onClick={apply}>
                  {pending ? "Création…" : "Créer les deux factures globales"}
                </Button>
              </>
            ) : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
