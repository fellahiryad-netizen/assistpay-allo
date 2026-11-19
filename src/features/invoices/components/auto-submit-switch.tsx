"use client";

import { cn } from "@/utils/cn";

/** Propriétés de l'interrupteur de formulaire. */
export interface AutoSubmitSwitchProps {
  name: string;
  label: string;
  defaultChecked: boolean;
}

/** Interrupteur (case à cocher accessible) qui valide le formulaire GET qui le contient dès qu'on le change. */
export function AutoSubmitSwitch({ name, label, defaultChecked }: Readonly<AutoSubmitSwitchProps>): React.JSX.Element {
  return (
    <label className="inline-flex h-10 cursor-pointer items-center gap-2 text-sm font-medium">
      <input type="checkbox" role="switch" name={name} value="1" defaultChecked={defaultChecked} onChange={(event) => event.currentTarget.form?.requestSubmit()} className="peer sr-only" />
      <span aria-hidden className={cn("relative h-6 w-11 rounded-full border border-input bg-muted transition-colors peer-checked:border-primary peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring", "after:absolute after:left-0.5 after:top-0.5 after:size-4 after:rounded-full after:bg-card after:shadow after:transition-transform peer-checked:after:translate-x-5")} />
      {label}
    </label>
  );
}
