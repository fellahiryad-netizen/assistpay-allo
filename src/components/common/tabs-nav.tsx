import Link from "next/link";
import { cn } from "@/utils/cn";

/** Onglet de navigation (lien). */
export interface TabLink {
  href: string;
  label: string;
  active: boolean;
  count?: number;
}

/** Barre d'onglets sous forme de liens (état dans l'URL). */
export function TabsNav({ tabs }: Readonly<{ tabs: TabLink[] }>): React.JSX.Element {
  return (
    <nav className="mb-4 flex gap-1 overflow-x-auto border-b" aria-label="Onglets">
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          aria-current={tab.active ? "page" : undefined}
          className={cn(
            "-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors",
            tab.active ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {tab.label}
          {tab.count ? <span className="rounded-full bg-primary/10 px-1.5 text-xs text-primary">{tab.count}</span> : null}
        </Link>
      ))}
    </nav>
  );
}
