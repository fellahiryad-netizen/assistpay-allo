"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Save, Trash2 } from "lucide-react";
import { clearManualBalanceAction, saveManualBalanceAction, saveTreasurySettingsAction } from "@/app/actions/treasury-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { CUSHION_CHOICES, type CushionDays } from "@/features/treasury/types";
import { parseLooseAmount } from "@/utils/amounts";

/** Propriétés du panneau de réglages (données sérialisables). */
export interface TreasurySettingsPanelProps {
  coussinJours: CushionDays;
  encaissementsAttendus: boolean;
  /** Un solde saisi à la main existe-t-il ? */
  hasManual: boolean;
  /** La saisie manuelle est-elle permise (aucun relevé valide, ou dernier relevé refusé) ? */
  manualAllowed: boolean;
  today: string;
}

/** Réglages réservés à l'Administrateur et à la Direction : réserve conseillée, encaissements attendus, solde de secours saisi à la main. */
export function TreasurySettingsPanel({ coussinJours, encaissementsAttendus, hasManual, manualAllowed, today }: Readonly<TreasurySettingsPanelProps>): React.JSX.Element {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [days, setDays] = useState<CushionDays>(coussinJours);
  const [expected, setExpected] = useState(encaissementsAttendus);
  const [balance, setBalance] = useState("");
  const [date, setDate] = useState(today);
  const [source, setSource] = useState("");

  function run(task: () => Promise<{ success: boolean; error?: string }>, done: string): void {
    startTransition(async () => {
      const result = await task();
      setMessage(result.success ? { kind: "ok", text: done } : { kind: "error", text: result.error ?? "L'opération a échoué." });
      if (result.success) router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Réglages</CardTitle>
        <CardDescription>Administrateur et Direction uniquement.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {message ? (
          <p role={message.kind === "error" ? "alert" : "status"} className={`rounded-md border-2 p-2 text-sm font-medium ${message.kind === "error" ? "border-destructive bg-destructive/10" : "border-success bg-success/10"}`}>
            {message.text}
          </p>
        ) : null}
        <div className="flex flex-wrap items-end gap-3">
          <Field id="tr-days" label="Réserve conseillée">
            <NativeSelect id="tr-days" value={days} onChange={(event) => setDays(Number(event.target.value) as CushionDays)}>
              {CUSHION_CHOICES.map((choice) => (
                <option key={choice} value={choice}>
                  {choice} jours de dépenses
                </option>
              ))}
            </NativeSelect>
          </Field>
          <label className="flex items-center gap-2 pb-2 text-sm font-medium">
            <input type="checkbox" checked={expected} onChange={(event) => setExpected(event.target.checked)} />
            Montrer les encaissements attendus (non garantis)
          </label>
          <Button type="button" disabled={pending} onClick={() => run(() => saveTreasurySettingsAction({ coussinJours: days, encaissementsAttendus: expected }), "Réglages enregistrés.")}>
            <Save />
            Enregistrer
          </Button>
        </div>

        <div className="space-y-2 border-t pt-4">
          <h3 className="text-sm font-semibold">Solde saisi à la main (secours)</h3>
          <p className="text-sm text-muted-foreground">Le solde vient toujours du dernier relevé importé. La saisie manuelle n&apos;est possible que si aucun relevé valide n&apos;est enregistré ou si le dernier relevé a été refusé ; elle disparaît dès qu&apos;un relevé valide plus récent est importé.</p>
          {manualAllowed ? (
            <div className="grid gap-3 sm:grid-cols-4">
              <Field id="tr-man-balance" label="Solde (DA)">
                <Input id="tr-man-balance" inputMode="decimal" value={balance} onChange={(event) => setBalance(event.target.value)} placeholder="0,00" />
              </Field>
              <Field id="tr-man-date" label="Date du solde">
                <Input id="tr-man-date" type="date" max={today} value={date} onChange={(event) => setDate(event.target.value)} />
              </Field>
              <Field id="tr-man-source" label="Source" className="sm:col-span-2">
                <Input id="tr-man-source" value={source} maxLength={120} onChange={(event) => setSource(event.target.value)} placeholder="Relevé AGB du 22/11/2026" />
              </Field>
              <div>
                <Button
                  type="button"
                  variant="violet"
                  disabled={pending}
                  onClick={() => {
                    const value = parseLooseAmount(balance);
                    if (!Number.isFinite(value)) setMessage({ kind: "error", text: "Indiquez le solde." });
                    else run(() => saveManualBalanceAction({ balance: value, date, source }), "Solde saisi à la main enregistré.");
                  }}
                >
                  Enregistrer le solde
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-sm">Un relevé valide est enregistré : la saisie manuelle n&apos;est pas disponible.</p>
          )}
          {hasManual ? (
            <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => run(() => clearManualBalanceAction(), "Solde saisi à la main retiré.")}>
              <Trash2 />
              Retirer le solde saisi à la main
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
