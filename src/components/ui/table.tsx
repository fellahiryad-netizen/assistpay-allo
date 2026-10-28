import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { cn } from "@/utils/cn";

/** Tableau avec défilement horizontal sur petit écran. */
export function Table({ className, ...props }: Readonly<HTMLAttributes<HTMLTableElement>>): React.JSX.Element {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn("w-full caption-bottom text-sm", className)} {...props} />
    </div>
  );
}

/** En-tête de tableau. */
export function TableHeader({ className, ...props }: Readonly<HTMLAttributes<HTMLTableSectionElement>>): React.JSX.Element {
  return <thead className={cn("bg-muted/60 [&_tr]:border-b", className)} {...props} />;
}

/** Corps de tableau. */
export function TableBody({ className, ...props }: Readonly<HTMLAttributes<HTMLTableSectionElement>>): React.JSX.Element {
  return <tbody className={cn("[&_tr:last-child]:border-0", className)} {...props} />;
}

/** Ligne de tableau. */
export function TableRow({ className, ...props }: Readonly<HTMLAttributes<HTMLTableRowElement>>): React.JSX.Element {
  return <tr className={cn("border-b transition-colors hover:bg-muted/40", className)} {...props} />;
}

/** Cellule d'en-tête. */
export function TableHead({ className, ...props }: Readonly<ThHTMLAttributes<HTMLTableCellElement>>): React.JSX.Element {
  return <th className={cn("h-10 whitespace-nowrap px-3 text-left align-middle text-xs font-semibold uppercase tracking-wide text-muted-foreground", className)} {...props} />;
}

/** Cellule. */
export function TableCell({ className, ...props }: Readonly<TdHTMLAttributes<HTMLTableCellElement>>): React.JSX.Element {
  return <td className={cn("px-3 py-2.5 align-middle", className)} {...props} />;
}

/** Pied de tableau (totaux). */
export function TableFooter({ className, ...props }: Readonly<HTMLAttributes<HTMLTableSectionElement>>): React.JSX.Element {
  return <tfoot className={cn("border-t bg-muted/40 font-semibold [&_tr]:hover:bg-transparent", className)} {...props} />;
}
