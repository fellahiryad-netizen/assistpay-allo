import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/utils/cn";

/** Propriétés d'un champ de formulaire avec étiquette et message d'erreur. */
export interface FieldProps {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  className?: string;
  children: ReactNode;
}

/** Champ de formulaire : étiquette, contrôle, aide et erreur. */
export function Field({ id, label, error, hint, className, children }: Readonly<FieldProps>): React.JSX.Element {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && !error ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
