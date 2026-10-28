import { Badge } from "@/components/ui/badge";
import type { Severity } from "@/features/transfers/types";

const LABELS: Readonly<Record<Severity, { label: string; variant: "success" | "accent" | "warning" | "destructive" }>> = {
  ok: { label: "Conforme", variant: "success" },
  info: { label: "Info", variant: "accent" },
  warn: { label: "À vérifier", variant: "warning" },
  err: { label: "Bloquant", variant: "destructive" },
};

/** Pastille de gravité d'un contrôle. */
export function SeverityBadge({ severity }: Readonly<{ severity: Severity | string }>): React.JSX.Element {
  const entry = LABELS[(severity in LABELS ? severity : "info") as Severity];
  return <Badge variant={entry.variant}>{entry.label}</Badge>;
}
