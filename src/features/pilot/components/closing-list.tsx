import Link from "next/link";
import { AlertTriangle, Check, X } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import type { ClosingItem } from "@/features/pilot/types";
import { cn } from "@/utils/cn";

const MARKS = {
  ok: { Icon: Check, className: "bg-success/10 text-success", label: "Fait" },
  warn: { Icon: AlertTriangle, className: "bg-warning/10 text-warning", label: "À vérifier" },
  err: { Icon: X, className: "bg-destructive/10 text-destructive", label: "À faire" },
} as const;

/** Liste de clôture du mois. */
export function ClosingList({ items }: Readonly<{ items: ClosingItem[] }>): React.JSX.Element {
  return (
    <ul className="flex flex-col divide-y rounded-lg border bg-card">
      {items.map((item) => {
        const mark = MARKS[item.state];
        return (
          <li key={item.title} className="flex items-start gap-3 p-3">
            <span className={cn("mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full", mark.className)} title={mark.label}>
              <mark.Icon className="size-3.5" aria-hidden />
              <span className="sr-only">{mark.label}</span>
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-medium">{item.title}</p>
              <p className="text-sm text-muted-foreground">{item.detail}</p>
            </div>
            {item.href ? (
              <Link href={item.href} className={buttonVariants({ size: "sm", variant: "outline" })}>
                Ouvrir
              </Link>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
