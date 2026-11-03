import type { ReactNode } from "react";
import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { Header } from "@/components/common/header";
import { filterNav, NAV_GROUPS } from "@/components/common/nav-items";
import { Sidebar } from "@/components/common/sidebar";
import { countAlerts } from "@/features/invoices/services/alert-service";
import { autoCaatAdvances } from "@/features/invoices/services/caat-advances";
import { countPendingDeletions } from "@/features/invoices/services/deletion-service";
import { can, PROFILE_LABELS } from "@/features/access/services/access-rules";

export const dynamic = "force-dynamic";

/** Mise en page de l'application connectée : menu filtré selon les accès, en-tête, contenu. */
export default async function AppLayout({ children }: Readonly<{ children: ReactNode }>): Promise<React.JSX.Element> {
  const user = await requireUser();
  const groups = filterNav(NAV_GROUPS, (module) => {
    if (module === "all") return true;
    if (module === "admin") return user.isAdmin;
    if (module === "invoices") return can(user, "FCLI") || can(user, "FFOUR");
    return can(user, module);
  });
  await autoCaatAdvances(user);
  const alerts = groups.some((group) => group.items.some((item) => item.href === "/alertes")) ? await countAlerts(user) : 0;
  const pendingDeletions = await countPendingDeletions(user);
  const withBadges = groups.map((group) => ({ ...group, items: group.items.map((item) => (item.href === "/alertes" ? { ...item, badge: alerts } : item.href === "/suppressions" ? { ...item, badge: pendingDeletions } : item)) }));
  return (
    <div className="flex min-h-screen">
      <Suspense fallback={<div className="hidden w-72 shrink-0 border-r bg-card lg:block" />}>
        <Sidebar groups={withBadges} />
      </Suspense>
      <div className="flex min-w-0 flex-1 flex-col">
        <Header userName={user.name} profileLabel={PROFILE_LABELS[user.profile]} />
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-5 sm:px-6 sm:py-6">{children}</main>
      </div>
    </div>
  );
}
