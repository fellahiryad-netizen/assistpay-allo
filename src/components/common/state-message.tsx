import type { ReactNode } from "react";
import { AlertTriangle, Inbox, Lock } from "lucide-react";
import { cn } from "@/utils/cn";

/** Propriétés du message d'état. */
export interface StateMessageProps {
  kind: "empty" | "error" | "forbidden";
  title: string;
  message?: string;
  action?: ReactNode;
  className?: string;
}

const ICONS = { empty: Inbox, error: AlertTriangle, forbidden: Lock } as const;

/** Message centré pour une liste vide, une erreur ou un accès refusé. */
export function StateMessage({ kind, title, message, action, className }: Readonly<StateMessageProps>): React.JSX.Element {
  const Icon = ICONS[kind];
  return (
    <div className={cn("flex flex-col items-center gap-2 rounded-lg border border-dashed bg-card px-6 py-12 text-center", className)}>
      <Icon className={cn("size-8", kind === "error" ? "text-destructive" : "text-muted-foreground")} />
      <p className="font-medium">{title}</p>
      {message ? <p className="max-w-md text-sm text-muted-foreground">{message}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
