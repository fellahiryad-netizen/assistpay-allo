"use client";

import { useState, useTransition } from "react";
import { CalendarPlus } from "lucide-react";
import { createCaatAdvancesAction } from "@/app/actions/invoice-actions";
import { Notice } from "@/components/common/notice";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { MONTHS_FR } from "@/utils/dates";

/** Propriétés : mois proposé par défaut (le mois écoulé) et mois affichés. */
export interface CaatAdvancesButtonProps {
  defaultPeriod: string;
  periods: string[];
}

/** « Créer les 9 avances du mois » : une ligne d'avance 90 % HT par succursale CAAT, sans doublon. */
export function CaatAdvancesButton({ defaultPeriod, periods }: Readonly<CaatAdvancesButtonProps>): React.JSX.Element {
  const [period, setPeriod] = useState(defaultPeriod);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);
  const label = (value: string): string => `${MONTHS_FR[Number(value.slice(5, 7)) - 1] ?? ""} ${value.slice(0, 4)}`;

  function run(): void {
    setMessage(null);
    startTransition(async () => {
      const result = await createCaatAdvancesAction({ period });
      if (!result.success) setMessage({ tone: "error", text: result.error });
      else if (result.data.created) setMessage({ tone: "success", text: `${result.data.created} ligne(s) d'avance CAAT créée(s) pour ${label(period)}.` });
      else setMessage({ tone: "info", text: `Les 9 lignes d'avance de ${label(period)} existent déjà.` });
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <NativeSelect value={period} onChange={(event) => setPeriod(event.target.value)} aria-label="Mois des avances CAAT">
          {periods.map((value) => (
            <option key={value} value={value}>
              {label(value)}
            </option>
          ))}
        </NativeSelect>
        <Button type="button" variant="outline" disabled={pending} onClick={run}>
          <CalendarPlus />
          Créer les 9 avances CAAT du mois
        </Button>
      </div>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
    </div>
  );
}
