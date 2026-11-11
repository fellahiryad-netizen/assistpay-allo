import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/common/page-header";
import { StateMessage } from "@/components/common/state-message";
import { buttonVariants } from "@/components/ui/button";
import { DashboardView } from "@/features/dashboard/components/dashboard-view";
import { TodoList } from "@/features/dashboard/components/todo-list";
import { getDashboard } from "@/features/dashboard/services/dashboard-service";
import { getTodo } from "@/features/dashboard/services/todo-service";
import { visibleSens } from "@/features/invoices/services/invoice-rules";

export const metadata: Metadata = { title: "Tableau de bord" };

/** Tableau de bord. */
export default async function DashboardPage(): Promise<React.JSX.Element> {
  const user = await requireUser();
  const [result, todo] = await Promise.all([getDashboard(user), getTodo(user)]);
  if (!result.success) {
    const sens = visibleSens(user)[0];
    return (
      <StateMessage
        kind={result.code === "FORBIDDEN" ? "forbidden" : "error"}
        title={result.code === "FORBIDDEN" ? "Le tableau de bord ne fait pas partie de vos accès" : "Tableau de bord indisponible"}
        message={result.error}
        action={
          sens ? (
            <Link href={`/factures?sens=${sens}`} className={buttonVariants({ variant: "outline" })}>
              Aller aux factures
            </Link>
          ) : undefined
        }
      />
    );
  }
  return (
    <>
      <PageHeader title={`Bonjour ${user.name.split(" ")[0] ?? ""}`} description="Créances, dettes fournisseurs et règlements en un coup d'œil." />
      <TodoList items={todo} />
      <DashboardView data={result.data} />
    </>
  );
}
