"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { importStatementFromTreasuryAction } from "@/app/actions/treasury-actions";
import { FileDrop } from "@/components/common/file-drop";
import { Notice } from "@/components/common/notice";
import { Button } from "@/components/ui/button";
import type { TreasuryImportResult } from "@/features/treasury/services/treasury-statement-upload";
import { formatDA, formatDate } from "@/utils/format";

/** Propriétés de l'import de relevé (données sérialisables). */
export interface StatementImportProps {
  /** « zone » : grande zone de dépôt (écran vide). « bouton » : bouton permanent. */
  mode: "zone" | "bouton";
  /** Le profil peut-il modifier le module Relevé bancaire ? Sinon un message clair remplace le bouton. */
  canImport: boolean;
}

/** Lignes du résultat d'import, en français simple. */
export function importSummary(result: TreasuryImportResult): { tone: "success" | "warning" | "error"; title: string; details: string[] } {
  const balance = result.balance;
  const lines = `${result.linesTotal} ligne${result.linesTotal > 1 ? "s" : ""} lue${result.linesTotal > 1 ? "s" : ""} dans le fichier : ${result.newLines} nouvelle${result.newLines > 1 ? "s" : ""}, ${result.alreadyKnown} déjà connue${result.alreadyKnown > 1 ? "s" : ""}, ${result.bankFees} frais bancaire${result.bankFees > 1 ? "s" : ""} écarté${result.bankFees > 1 ? "s" : ""}${result.grouped > 0 ? `, ${result.grouped} ligne${result.grouped > 1 ? "s" : ""} identique${result.grouped > 1 ? "s" : ""} regroupée${result.grouped > 1 ? "s" : ""} (même date, montant et libellé)` : ""}.`;
  const next = result.toValidate + result.toProcess > 0 ? [`À voir dans « Relevé bancaire » : ${result.toValidate} rapprochement(s) à valider, ${result.toProcess} paiement(s) à traiter.`] : [];
  if (!balance) return { tone: "warning", title: "Le relevé a été importé, mais le solde n'a pas pu être lu.", details: [lines, ...next] };
  if (balance.status === "enregistre") {
    return {
      tone: "success",
      title: `Solde lu : ${formatDA(balance.amount ?? 0)} au ${formatDate(balance.date)}.`,
      details: [`Contrôles de cohérence réussis (formule du solde, dernière ligne, enchaînement des ${balance.rows ?? 0} opérations).`, lines, ...next],
    };
  }
  const reasons: Record<NonNullable<BalanceRecordOutcome["reason"]>, string> = {
    structure: "Ce fichier ne contient pas la ligne « Solde FIN AU » du relevé AGB : le solde n'a pas été lu.",
    ancien: "Relevé plus ancien que le solde déjà enregistré : le solde n'a pas été remplacé.",
    compte: "Le relevé est celui d'un autre compte que le compte AGB 2737851208 : il est refusé pour le solde.",
    incoherent: "Les contrôles de cohérence du relevé ont échoué : le solde n'a pas été enregistré et l'ancien est conservé.",
  };
  return { tone: balance.status === "refuse" ? "error" : "warning", title: reasons[balance.reason ?? "structure"], details: [balance.message, lines, ...next] };
}

type BalanceRecordOutcome = NonNullable<TreasuryImportResult["balance"]>;

/**
 * Import d'un relevé AGB depuis l'onglet Trésorerie (même flux que « Relevé bancaire »).
 * Après l'import : résultat explicite (solde, date, contrôles ou motif du refus, lignes nouvelles et déjà connues), puis rafraîchissement de la page.
 */
export function StatementImport({ mode, canImport }: Readonly<StatementImportProps>): React.JSX.Element {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: true; data: TreasuryImportResult } | { ok: false; error: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  function send(file: File): void {
    setResult(null);
    const form = new FormData();
    form.set("file", file);
    startTransition(async () => {
      try {
        const response = await importStatementFromTreasuryAction(form);
        setResult(response.success ? { ok: true, data: response.data } : { ok: false, error: response.error });
      } catch {
        setResult({ ok: false, error: "L'envoi du fichier a échoué (connexion ou délai dépassé). Réessayez ; si le problème persiste, importez le relevé depuis « Relevé bancaire »." });
      }
      router.refresh();
    });
  }

  if (!canImport) {
    return (
      <Notice tone="warning">
        <b>Import du relevé indisponible pour votre profil.</b> L&apos;import passe par le module « Relevé bancaire », que vous ne pouvez pas modifier. Demandez ce droit à l&apos;administrateur, ou faites importer le relevé par un collègue qui l&apos;a.
      </Notice>
    );
  }
  const summary = result?.ok ? importSummary(result.data) : null;
  return (
    <div className="space-y-2">
      {mode === "zone" ? (
        <FileDrop label={pending ? "Lecture du relevé en cours…" : "Importer un relevé AGB"} hint="Fichier du relevé exporté de la banque : Excel (.xls, .xlsx) ou CSV. Le solde est lu dans la ligne « Solde FIN AU »." disabled={pending} onFile={send} />
      ) : (
        <>
          <Button type="button" variant="outline" disabled={pending} onClick={() => input.current?.click()}>
            <Upload />
            {pending ? "Lecture du relevé en cours…" : "Importer un relevé AGB"}
          </Button>
          <input
            ref={input}
            type="file"
            accept=".xlsx,.xls,.xlsm,.csv"
            className="sr-only"
            aria-label="Fichier du relevé AGB"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) send(file);
              event.target.value = "";
            }}
          />
        </>
      )}
      {result && !result.ok ? <Notice tone="error">{result.error}</Notice> : null}
      {summary ? (
        <Notice tone={summary.tone}>
          <b>{summary.title}</b>
          {summary.details.map((line) => (
            <span key={line} className="mt-1 block">
              {line}
            </span>
          ))}
        </Notice>
      ) : null}
    </div>
  );
}
