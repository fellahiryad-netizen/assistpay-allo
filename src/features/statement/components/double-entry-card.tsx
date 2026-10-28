"use client";

import { useState, useTransition } from "react";
import { CheckCheck, X } from "lucide-react";
import { applyDoubleEntryAction, markNotDoubleAction } from "@/app/actions/statement-actions";
import { Notice } from "@/components/common/notice";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import type { DoubleEntryCase } from "@/features/statement/types/double-entry";
import { round2 } from "@/utils/amounts";
import { formatDA, formatDate } from "@/utils/format";

/** Propriétés de la carte de double emploi. */
export interface DoubleEntryCardProps {
  item: DoubleEntryCase;
  canEdit: boolean;
}

/** Cas de double emploi au Débit : à valider, ou à noter comme autre virement. */
export function DoubleEntryCard({ item, canEdit }: Readonly<DoubleEntryCardProps>): React.JSX.Element {
  const [chosen, setChosen] = useState<Set<string>>(new Set(item.kind === "global" ? item.preselected : []));
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  function notDouble(ids: string[]): void {
    startTransition(async () => {
      const result = await markNotDoubleAction({ ids });
      setMessage(result.success ? { tone: "success", text: "Noté : ce ne sont pas des doublons." } : { tone: "error", text: result.error });
    });
  }

  if (item.kind === "pair") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Virement global saisi deux fois ?</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <ul className="divide-y rounded-md border text-sm">
            {[item.a, item.b].map((row) => (
              <li key={row.id} className="flex flex-wrap justify-between gap-2 px-3 py-2">
                <span>
                  {formatDate(row.date)} · {row.label}
                </span>
                <b className="tabular-nums">{formatDA(row.montantGlobal ?? row.montant)}</b>
              </li>
            ))}
          </ul>
          {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
          {canEdit && !message ? (
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => notDouble([item.a.id, item.b.id])}>
                <X />
                C&apos;est un autre virement
              </Button>
              <Button type="button" size="sm" variant="ghost" asChild>
                <a href={`/factures/${item.b.id}`}>Ouvrir la seconde ligne pour l&apos;annuler</a>
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    );
  }

  const selectedSum = round2(item.candidates.filter((row) => chosen.has(row.id)).reduce((sum, row) => sum + row.montant, 0));
  const rest = round2(item.global.montant - selectedSum);

  function validate(): void {
    if (item.kind !== "global") return;
    startTransition(async () => {
      const result = await applyDoubleEntryAction({ globalId: item.global.id, detailIds: [...chosen] });
      setMessage(
        result.success
          ? { tone: "success", text: `${chosen.size} ligne(s) rattachée(s) au virement global, ramené à ${formatDA(result.data.remaining)}. Plus de double emploi.` }
          : { tone: "error", text: result.error },
      );
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">
          {item.exact ? "Correspondance exacte – " : ""}Virement global du {formatDate(item.global.date)} : {item.global.label} – {formatDA(item.global.montant)}
          {item.global.montantGlobal ? ` (d'origine ${formatDA(item.global.montantGlobal)})` : ""}
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          {item.transferRef
            ? `Détail retrouvé dans l'envoi « ${item.transferRef} » : les lignes correspondantes sont pré-cochées.`
            : item.exact
              ? `La somme de ${item.preselected.length} lignes saisies par prestataire est égale à ce virement.`
              : "Lignes saisies par prestataire dans les 40 jours précédents : cochez celles payées par ce virement global."}
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={() => setChosen(new Set(item.candidates.map((row) => row.id)))}>
              Tout cocher
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setChosen(new Set())}>
              Tout décocher
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                const next = new Set<string>();
                let sum = 0;
                for (const row of [...item.candidates].sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""))) {
                  if (sum + row.montant <= item.global.montant + 1) {
                    next.add(row.id);
                    sum += row.montant;
                  }
                }
                setChosen(next);
              }}
            >
              Cocher jusqu&apos;au montant du global
            </Button>
          </div>
        ) : null}
        <ul className="max-h-72 divide-y overflow-y-auto rounded-md border text-sm">
          {item.candidates.map((row) => (
            <li key={row.id}>
              <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-muted/40">
                <Checkbox
                  disabled={!canEdit}
                  checked={chosen.has(row.id)}
                  onChange={(event) =>
                    setChosen((current) => {
                      const next = new Set(current);
                      if (event.target.checked) next.add(row.id);
                      else next.delete(row.id);
                      return next;
                    })
                  }
                />
                <span className="min-w-0 flex-1 truncate">
                  {formatDate(row.date)} · {row.label}
                </span>
                <b className="tabular-nums">{formatDA(row.montant)}</b>
              </label>
            </li>
          ))}
        </ul>
        <p className={rest < -1 || chosen.size === 0 ? "text-sm font-medium text-warning" : "text-sm text-success"}>
          {chosen.size === 0
            ? "Aucune ligne cochée."
            : `Cochées : ${chosen.size} ligne(s) = ${formatDA(selectedSum)} · global restant après validation : ${formatDA(rest)}${rest < -1 ? " — les lignes cochées dépassent le virement" : ""}`}
        </p>
        {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
        {canEdit && message?.tone !== "success" ? (
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={pending || chosen.size === 0 || rest < -1} onClick={validate}>
              <CheckCheck />
              Valider : ces lignes sont payées par ce global
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => notDouble([item.global.id])}>
              <X />
              C&apos;est un autre virement
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
