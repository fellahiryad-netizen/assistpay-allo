"use client";

import { ACTIVITIES, ACTIVITY_LABELS, type Activity } from "@/features/invoices/lib/activity";
import { cn } from "@/utils/cn";

/** Propriétés du choix d'activité. */
export interface ActivityChoiceProps {
  value: Activity | "";
  onChange: (value: Activity) => void;
  error?: string;
  /** Indication affichée sous le titre (ex. activité suggérée par la catégorie). */
  hint?: string;
}

const HINTS: Readonly<Record<Activity, string>> = {
  assistance: "Dépannage, remorquage",
  bdg: "Bris de glace",
  autre: "TVA, TPA, IT, divers",
};

/** Choix de l'activité d'une facture fournisseur : trois grands boutons radio, le choix est toujours visible. */
export function ActivityChoice({ value, onChange, error, hint }: Readonly<ActivityChoiceProps>): React.JSX.Element {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-sm font-medium">Activité</legend>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" role="radiogroup" aria-invalid={error ? true : undefined}>
        {ACTIVITIES.map((activity) => {
          const checked = value === activity;
          return (
            <label key={activity} className={cn("flex cursor-pointer items-center gap-3 rounded-md border bg-card p-3 transition-colors", checked ? "border-primary bg-primary/5" : "hover:bg-muted")}>
              <input type="radio" name="activite" value={activity} checked={checked} onChange={() => onChange(activity)} className="peer sr-only" />
              <span aria-hidden className={cn("grid size-5 shrink-0 place-items-center rounded-full border-2 peer-focus-visible:ring-2 peer-focus-visible:ring-ring", checked ? "border-primary" : "border-input")}>
                <span className={cn("size-2.5 rounded-full", checked ? "bg-primary" : "bg-transparent")} />
              </span>
              <span className="leading-tight">
                <span className="block text-sm font-medium">{ACTIVITY_LABELS[activity]}</span>
                <span className="block text-xs text-muted-foreground">{HINTS[activity]}</span>
              </span>
            </label>
          );
        })}
      </div>
      {hint && !error ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {error ? (
        <p role="alert" className="text-xs font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
