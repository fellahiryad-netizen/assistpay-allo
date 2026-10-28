import type { ReactNode } from "react";
import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { Header } from "@/components/common/header";
import { filterNav, NAV_GROUPS } from "@/components/common/nav-items";
import { Sidebar } from "@/components/common/sidebar";
import { can, PROFILE_LABELS } from "@/features/access/services/access-rules";

export const dynamic = "force-dynamic";

/** Mise en page de l'application connectée : menu filtré selon les accès, en-tête, contenu. */
export default async function AppLayout({ children }: Readonly<{ children: ReactNode }>): Promise<React.JSX.Element> {
  const user = await requireUser();
  const groups = filterNav(NAV_GROUPS, (module) => {
    if (module === "all") return true;
    if (module === "admin") return user.isAdmin;
    return can(user, module);
  });
  return (
    <div className="flex min-h-screen">
      <Suspense fallback={<div className="hidden w-72 shrink-0 border-r bg-card lg:block" />}>
        <Sidebar groups={groups} />
      </Suspense>
      <div className="flex min-w-0 flex-1 flex-col">
        <Header userName={user.name} profileLabel={PROFILE_LABELS[user.profile]} />
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-5 sm:px-6 sm:py-6">{children}</main>
      </div>
    </div>
  );
}
