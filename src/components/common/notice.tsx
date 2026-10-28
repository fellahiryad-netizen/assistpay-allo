import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { cn } from "@/utils/cn";

/** Propriétés du message. */
export interface NoticeProps {
  tone: "info" | "success" | "error" | "warning";
  children: ReactNode;
  className?: string;
}

const STYLES = {
  info: "bg-accent/10 text-foreground",
  success: "bg-success/10 text-success",
  error: "bg-destructive/10 text-destructive",
  warning: "bg-warning/10 text-foreground",
} as const;

/** Message d'information, de réussite ou d'erreur. */
export function Notice({ tone, children, className }: Readonly<NoticeProps>): React.JSX.Element {
  const Icon = tone === "success" ? CheckCircle2 : tone === "info" ? Info : AlertTriangle;
  return (
    <div role={tone === "error" ? "alert" : "status"} className={cn("flex items-start gap-2 rounded-md p-3 text-sm", STYLES[tone], className)}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
