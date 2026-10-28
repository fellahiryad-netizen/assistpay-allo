"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import {
  Gauge,
  ClipboardCheck,
  ArrowDownLeft,
  ArrowUpRight,
  Building2,
  Car,
  CopyCheck,
  FilePlus2,
  Handshake,
  HandCoins,
  Landmark,
  LayoutDashboard,
  ScrollText,
  Send,
  ShieldCheck,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useSidebarStore } from "@/components/common/sidebar-store";
import type { NavGroup, NavIcon } from "@/components/common/nav-items";
import { cn } from "@/utils/cn";

const ICONS: Readonly<Record<NavIcon, LucideIcon>> = {
  dashboard: LayoutDashboard,
  pilot: Gauge,
  quality: ClipboardCheck,
  credit: ArrowDownLeft,
  debit: ArrowUpRight,
  partners: Handshake,
  invoice: FilePlus2,
  caar: Car,
  bdg: Building2,
  request: HandCoins,
  transfer: Send,
  bank: Landmark,
  double: CopyCheck,
  hr: Users,
  users: ShieldCheck,
  journal: ScrollText,
  account: UserRound,
};

/** Propriétés du menu latéral. */
export interface SidebarProps {
  groups: NavGroup[];
}

function matches(href: string, pathname: string, sens: string | null): boolean {
  const [path, query] = href.split("?");
  if (path === "/") return pathname === "/";
  if (!path || !(pathname === path || pathname.startsWith(`${path}/`))) return false;
  if (!query) return true;
  return new URLSearchParams(query).get("sens") === sens;
}

/** Entrée active : la plus précise de celles qui correspondent à l'adresse. */
function activeHref(groups: NavGroup[], pathname: string, sens: string | null): string | null {
  const candidates = groups.flatMap((group) => group.items).filter((item) => matches(item.href, pathname, sens));
  candidates.sort((a, b) => b.href.length - a.href.length);
  return candidates[0]?.href ?? null;
}

/** Menu latéral : fixe sur grand écran, tiroir sur mobile ; défilement propre si le menu est long. */
export function Sidebar({ groups }: Readonly<SidebarProps>): React.JSX.Element {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const sens = searchParams.get("sens");
  const open = useSidebarStore((state) => state.open);
  const setOpen = useSidebarStore((state) => state.setOpen);
  const current = activeHref(groups, pathname, sens);

  useEffect(() => {
    setOpen(false);
  }, [pathname, sens, setOpen]);

  return (
    <>
      <div
        aria-hidden
        onClick={() => setOpen(false)}
        className={cn("fixed inset-0 z-30 bg-foreground/40 lg:hidden", open ? "block" : "hidden")}
      />
      <aside
        className={cn(
          "neo-side fixed inset-y-0 left-0 z-40 flex w-72 flex-col transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="neo-brand flex shrink-0 items-center gap-3 px-5 py-4">
          <img src="/logo-allo.png" alt="Allo Assistance" width={80} height={44} className="neo-logo" />
          <div className="leading-tight">
            <p className="neo-word">
              Assist<span>Pay</span>
            </p>
            <p className="neo-tag">Créances · Banque</p>
          </div>
        </div>
        <nav className="neo-scroll flex-1 overflow-y-auto px-3 py-4" aria-label="Menu principal">
          {groups.map((group) => (
            <div key={group.label} className="mb-3">
              <p className="neo-group">{group.label}</p>
              <ul className="flex flex-col gap-0.5">
                {group.items.map((item) => {
                  const Icon = ICONS[item.icon];
                  const active = item.href === current;
                  return (
                    <li key={item.href}>
                      <Link href={item.href} aria-current={active ? "page" : undefined} className="neo-link">
                        <span className="neo-icon">
                          <Icon className="size-4" aria-hidden />
                        </span>
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
        <div className="neo-foot flex shrink-0 items-center gap-2 px-5 py-3">
          <span className="neo-pulse" aria-hidden />
          <span>EURL ALLO ASSISTANCE · Chéraga</span>
        </div>
      </aside>
    </>
  );
}
