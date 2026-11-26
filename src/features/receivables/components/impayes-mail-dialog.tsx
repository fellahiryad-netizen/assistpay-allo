"use client";

import { useEffect, useState, useTransition } from "react";
import { Copy, Mail } from "lucide-react";
import { impayesMailAction } from "@/app/actions/receivables-actions";
import { Notice } from "@/components/common/notice";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { LATE_DAYS_CHOICES, type ImpayesMail } from "@/features/receivables/lib/report-mail";
import { formatDA } from "@/utils/format";

/** Propriétés du bouton « Mail direction ». */
export interface ImpayesMailDialogProps {
  company: string;
  annee?: number;
  variant?: "violet" | "outline";
}

/** Mail préparé pour la direction : succursales en retard et mois en retard, à copier ou à ouvrir dans la messagerie. */
export function ImpayesMailDialog({ company, annee, variant = "outline" }: Readonly<ImpayesMailDialogProps>): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState<30 | 60 | 90>(30);
  const [mail, setMail] = useState<ImpayesMail | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [to, setTo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    setError(null);
    setCopied(false);
    startTransition(async () => {
      const result = await impayesMailAction({ company, annee, jours: days });
      if (result.success) {
        setMail(result.data);
        setSubject(result.data.subject);
        setBody(result.data.body);
      } else setError(result.error);
    });
  }, [open, company, annee, days]);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(`Objet : ${subject}\n\n${body}`);
      setCopied(true);
    } catch {
      setError("Copie impossible : sélectionnez le texte et copiez-le à la main.");
    }
  }

  const mailto = `mailto:${encodeURIComponent(to.trim())}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  const reportHref = `/api/creances/rapport?${new URLSearchParams({ detail: company, ...(annee ? { annee: String(annee) } : {}) }).toString()}`;

  return (
    <>
      <Button type="button" variant={variant} onClick={() => setOpen(true)} title={`Mail prêt à envoyer à la direction ${company}`}>
        <Mail />
        Mail direction {company}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Mail à la direction {company}</DialogTitle>
            <DialogDescription>Les succursales en retard et leurs mois en retard sont déjà écrits. Relisez, corrigez si besoin, puis copiez ou ouvrez dans votre messagerie. Pensez à joindre le rapport PDF.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              En retard à partir de
              <NativeSelect value={String(days)} onChange={(event) => setDays(Number(event.target.value) as 30 | 60 | 90)} className="w-44">
                {LATE_DAYS_CHOICES.map((value) => (
                  <option key={value} value={value}>
                    {value} jours
                  </option>
                ))}
              </NativeSelect>
            </label>
            <label className="flex min-w-56 flex-1 flex-col gap-1 text-xs text-muted-foreground">
              Destinataire (facultatif)
              <Input value={to} onChange={(event) => setTo(event.target.value)} type="email" placeholder="adresse e-mail de la direction" />
            </label>
          </div>
          {error ? <Notice tone="error">{error}</Notice> : null}
          {pending && !mail ? <p className="text-sm text-muted-foreground">Préparation du mail…</p> : null}
          {mail ? (
            <>
              <p className="text-sm text-muted-foreground">
                {mail.lateBranches.length > 0
                  ? `${mail.lateBranches.length} succursale(s) en retard, ${mail.lateCount} facture(s), ${formatDA(mail.lateAmount)}.`
                  : "Aucune succursale en retard avec ce délai."}
              </p>
              <label className="flex flex-col gap-1 text-xs font-medium">
                Objet
                <Input value={subject} onChange={(event) => setSubject(event.target.value)} />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium">
                Message
                <textarea value={body} onChange={(event) => setBody(event.target.value)} rows={16} className="w-full rounded-md border border-input bg-card px-3 py-2 font-sans text-sm leading-relaxed" />
              </label>
            </>
          ) : null}
          <DialogFooter className="sm:justify-between">
            <a href={reportHref} className={buttonVariants({ variant: "outline" })}>
              Télécharger le rapport PDF
            </a>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => void copy()} disabled={!mail}>
                <Copy />
                {copied ? "Copié" : "Copier le mail"}
              </Button>
              <a href={mailto} className={buttonVariants({})} aria-disabled={!mail}>
                <Mail />
                Ouvrir dans ma messagerie
              </a>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
