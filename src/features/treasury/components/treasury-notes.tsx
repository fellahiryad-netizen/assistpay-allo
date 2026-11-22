import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FOOTER_MENTION } from "@/features/treasury/lib/hypotheses";
import type { ControlsView } from "@/features/treasury/types/view";
import { formatDA, formatDate } from "@/utils/format";

/** Bloc « Hypothèses » : toujours visible. */
export function HypothesesBlock({ lines }: Readonly<{ lines: string[] }>): React.JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Hypothèses</CardTitle>
        <CardDescription>Ce qui est compté, et ce qui ne l&apos;est pas.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

const GAP_MESSAGE = "Le relevé importé est complet ; l'écart avec le journal du CRM vient des frais bancaires non saisis et de virements identiques regroupés.";

/** Bloc « Contrôles » : écart relevé / journal CRM, mouvements non rapprochés, anomalies RH (lecture seule). */
export function ControlsBlock({ controls }: Readonly<{ controls: ControlsView }>): React.JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Contrôles</CardTitle>
        <CardDescription>Lecture seule : rien n&apos;est corrigé ici.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {controls.checks ? (
          <p>
            Relevé : départ + crédits − débits {controls.checks.formula ? "conforme" : "ÉCART"}, dernier solde {controls.checks.lastLine ? "conforme" : "ÉCART"}, chaîne des soldes {controls.checks.chain ? "continue" : "ROMPUE"}.
          </p>
        ) : null}
        {controls.ledger ? (
          <p>
            <b>Écart relevé / journal du CRM : {formatDA(controls.ledger.gap)}</b> (solde recalculé depuis {controls.ledger.crmLines} lignes du CRM : {formatDA(controls.ledger.recomputed)}). {GAP_MESSAGE}
          </p>
        ) : null}
        <p>
          <b>Mouvements bancaires non rapprochés :</b> {controls.unmatched.debitCount} débit{controls.unmatched.debitCount > 1 ? "s" : ""} ({formatDA(controls.unmatched.debitTotal)}) et {controls.unmatched.creditCount} crédit
          {controls.unmatched.creditCount > 1 ? "s" : ""} ({formatDA(controls.unmatched.creditTotal)}) « à traiter ». Ils sont déjà dans le solde bancaire.{" "}
          <Link href="/releve" className="underline">
            Ouvrir le relevé
          </Link>
        </p>
        {controls.posterior.count > 0 ? (
          <p>
            <b>Mouvements du CRM postérieurs au relevé :</b> {controls.posterior.count} ligne{controls.posterior.count > 1 ? "s" : ""} ({formatDA(controls.posterior.total)}), non confirmées par le relevé et ajoutées au solde disponible.
          </p>
        ) : null}
        {controls.chequesToVerify.length > 0 ? (
          <p>
            <b>Chèques à vérifier (non déduits) :</b>{" "}
            {controls.chequesToVerify.map((cheque) => `${cheque.numero} (${formatDA(cheque.montant)}${cheque.date ? `, ${formatDate(cheque.date)}` : ", sans date"})`).join(" ; ")} : aucun débit retrouvé, mais trop anciens, sans date ou antérieurs aux lignes du relevé du CRM.
          </p>
        ) : null}
        {controls.pendingWithCheque > 0 ? (
          <p>
            <b>{controls.pendingWithCheque} facture{controls.pendingWithCheque > 1 ? "s" : ""} en attente portent un numéro de chèque :</b> elles restent dans le reste à payer (jamais comptées en circulation).
          </p>
        ) : null}
        {controls.gaps.length > 0 ? <p>Trous de plus de 7 jours dans le relevé : {controls.gaps.join(" ; ")}.</p> : null}
        <div>
          <p>
            <b>Anomalies RH (dates) :</b> {controls.hrAnomaliesTotal === 0 ? "aucune." : `${controls.hrAnomaliesTotal} écriture${controls.hrAnomaliesTotal > 1 ? "s" : ""} sans date ou à date absurde. Elles faussent l'anti-doublon et les suggestions ; à corriger dans l'onglet RH.`}
          </p>
          {controls.hrAnomalies.length > 0 ? (
            <ul className="mt-1 list-disc pl-5 text-muted-foreground">
              {controls.hrAnomalies.map((item) => (
                <li key={item.id}>
                  {item.nature} {item.libelle} — {formatDA(item.montant)} — {item.date ? `date ${formatDate(item.date)}` : "sans date"}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

/** Mention de bas de page. */
export function FooterMention(): React.JSX.Element {
  return <p className="text-center text-xs text-muted-foreground">{FOOTER_MENTION}</p>;
}
