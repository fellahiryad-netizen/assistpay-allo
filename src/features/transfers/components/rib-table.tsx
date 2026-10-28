"use client";

import { useState, useTransition } from "react";
import { ribActionAction } from "@/app/actions/transfer-actions";
import { Notice } from "@/components/common/notice";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RibFormDialog } from "@/features/transfers/components/rib-form-dialog";
import { BANKS, formatRib } from "@/features/transfers/services/rib";
import type { RibActionInput } from "@/features/transfers/schemas";
import type { ProviderRibDTO } from "@/features/transfers/types";
import { formatDA } from "@/utils/format";

const STATUS: Readonly<Record<string, { label: string; variant: "success" | "warning" | "muted" | "destructive" }>> = {
  actif: { label: "Actif", variant: "success" },
  a_valider: { label: "À valider", variant: "warning" },
  supprime: { label: "Supprimé", variant: "destructive" },
  remplace: { label: "Remplacé", variant: "muted" },
};

/** Référentiel RIB : comptes, changements à valider, actions. */
export function RibTable({ ribs, canEdit, isAdmin }: Readonly<{ ribs: ProviderRibDTO[]; canEdit: boolean; isAdmin: boolean }>): React.JSX.Element {
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function act(input: RibActionInput, confirmText?: string): void {
    if (confirmText && !window.confirm(confirmText)) return;
    startTransition(async () => {
      const result = await ribActionAction(input);
      setMessage(result.success ? { tone: "success", text: result.data } : { tone: "error", text: result.error });
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <ul className="divide-y rounded-lg border bg-card">
        {ribs.map((rib) => {
          const status = STATUS[rib.status] ?? { label: rib.status, variant: "muted" as const };
          const name = rib.noms[0] ?? rib.key;
          return (
            <li key={rib.id} className="flex flex-col gap-2 p-3 md:flex-row md:items-start md:gap-4">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2">
                  <b>{rib.noms.join(" / ") || "—"}</b>
                  <Badge variant={status.variant}>{status.label}</Badge>
                  {rib.isNew ? <Badge variant="accent">Nouveau</Badge> : null}
                  {rib.types.map((type) => (
                    <Badge key={type} variant="muted">
                      {type === "B" ? "BDG" : "Assistance"}
                    </Badge>
                  ))}
                </p>
                <p className="font-mono text-sm">
                  {formatRib(rib.rib)} <span className="font-sans text-xs text-muted-foreground">· {BANKS[rib.rib.slice(0, 3)] ?? "banque inconnue"}{rib.wilaya ? ` · ${rib.wilaya}` : ""}{rib.code ? ` · ${rib.code}` : ""}</span>
                </p>
                {rib.proposed ? (
                  <p className="mt-1 text-sm text-warning">
                    Nouveau RIB proposé : <span className="font-mono">{formatRib(rib.proposed.rib)}</span> ({rib.proposed.envoi}
                    {rib.proposed.by ? `, par ${rib.proposed.by}` : ""})
                  </p>
                ) : null}
                {rib.change?.type === "compte" ? <p className="mt-1 text-sm text-warning">Prestataire déjà connu avec un autre compte : {rib.change.others.join(", ")}</p> : null}
                <p className="text-xs text-muted-foreground">
                  {rib.history.count ? `${rib.history.count} virement(s) validé(s), ${formatDA(rib.history.total)}${rib.history.lastRef ? ` · dernier : ${rib.history.lastRef}` : ""}` : "Aucun virement validé"}
                  {rib.oldRibs.length ? ` · ancien(s) RIB : ${rib.oldRibs.map(formatRib).join(", ")}` : ""}
                  {rib.origine ? ` · ${rib.origine}` : ""}
                </p>
              </div>
              {canEdit ? (
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {rib.status === "a_valider" && isAdmin ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="success"
                      disabled={pending}
                      onClick={() =>
                        act(
                          { id: rib.id, action: "valider", replaceOld: Boolean(rib.change?.others.length) && window.confirm("Marquer aussi l'ancien compte comme remplacé ?") },
                          rib.proposed ? `Valider le nouveau RIB de ${name} ?\n\nAncien : ${rib.rib}\nNouveau : ${rib.proposed.rib}` : undefined,
                        )
                      }
                    >
                      Valider
                    </Button>
                  ) : null}
                  {rib.proposed ? (
                    <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => act({ id: rib.id, action: "refuser", replaceOld: false }, `Refuser le RIB proposé pour ${name} ?`)}>
                      Refuser le RIB proposé
                    </Button>
                  ) : null}
                  {rib.isNew && rib.status === "actif" ? (
                    <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => act({ id: rib.id, action: "confirmer", replaceOld: false })}>
                      Confirmer
                    </Button>
                  ) : null}
                  {rib.status === "supprime" ? (
                    <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => act({ id: rib.id, action: "restaurer", replaceOld: false })}>
                      Restaurer
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() => act({ id: rib.id, action: "supprimer", replaceOld: false }, `Supprimer le RIB ${rib.rib} de ${name} ? S'il réapparaît dans un envoi, la ligne sera bloquée.`)}
                    >
                      Supprimer
                    </Button>
                  )}
                  <RibFormDialog rib={rib} />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
