"use client";

import { SENS_KEYS, SENS_LABELS, type SensKey } from "@/features/invoices/types";
import { cn } from "@/utils/cn";

/** Propriétés du choix Débit / Crédit. */
export interface SensChoiceProps {
  value: SensKey | "";
  allowed: SensKey[];
  onChange: (value: SensKey) => void;
  error?: string;
}

const HINTS: Readonly<Record<SensKey, string>> = {
  CREDIT: "Facture client (encaissement)",
  DEBIT: "Facture fournisseur (décaissement)",
};

/** Choix du sens avec un rond bien visible, rempli de couleur quand il est sélectionné. */
export function SensChoice({ value, allowed, onChange, error }: Readonly<SensChoiceProps>): React.JSX.Element {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-sm font-medium">Sens</legend>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup" aria-invalid={error ? true : undefined}>
        {SENS_KEYS.map((sens) => {
          const checked = value === sens;
          const disabled = !allowed.includes(sens);
          return (
            <label
              key={sens}
              className={cn(
                "flex cursor-pointer items-center gap-3 rounded-md border bg-card p-3 transition-colors",
                checked ? "border-primary bg-primary/5" : "hover:bg-muted",
                disabled && "cursor-not-allowed opacity-50",
              )}
            >
              <input
                type="radio"
                name="sens"
                value={sens}
                checked={checked}
                disabled={disabled}
                onChange={() => onChange(sens)}
                className="peer sr-only"
              />
              <span
                aria-hidden
                className={cn(
                  "grid size-5 shrink-0 place-items-center rounded-full border-2 peer-focus-visible:ring-2 peer-focus-visible:ring-ring",
                  checked ? "border-primary" : "border-input",
                )}
              >
                <span className={cn("size-2.5 rounded-full", checked ? "bg-primary" : "bg-transparent")} />
              </span>
              <span className="leading-tight">
                <span className="block text-sm font-medium">{SENS_LABELS[sens]}</span>
                <span className="block text-xs text-muted-foreground">{HINTS[sens]}</span>
              </span>
            </label>
          );
        })}
      </div>
      {error ? (
        <p role="alert" className="text-xs font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
