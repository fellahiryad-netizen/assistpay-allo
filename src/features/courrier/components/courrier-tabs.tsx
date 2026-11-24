import Link from "next/link";
import { cn } from "@/utils/cn";

/** Propriétés des onglets du courrier. */
export interface CourrierTabsProps {
  current: "adresses" | "historique";
}

/** Onglets de la section courrier : adresses (succursales, EMS) et historique des bordereaux. */
export function CourrierTabs({ current }: Readonly<CourrierTabsProps>): React.JSX.Element {
  const tabs = [
    { key: "adresses", href: "/adresses-courrier", label: "Adresses" },
    { key: "historique", href: "/adresses-courrier/historique", label: "Historique des bordereaux" },
  ] as const;
  return (
    <nav aria-label="Sections du courrier" className="mb-5 flex flex-wrap gap-1 border-b">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={current === tab.key ? "page" : undefined}
          className={cn("-mb-px rounded-t-md border-b-2 px-4 py-2 text-sm font-medium", current === tab.key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
