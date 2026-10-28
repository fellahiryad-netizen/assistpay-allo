import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/common/page-header";
import { StateMessage } from "@/components/common/state-message";
import { AccessMatrix } from "@/features/users/components/access-matrix";
import { CreateUserDialog } from "@/features/users/components/create-user-dialog";
import { listUserAccess } from "@/features/users/services/users-service";

export const metadata: Metadata = { title: "Utilisateurs et accès" };

/** Tableau des accès (administrateurs uniquement ; le contrôle est fait dans le service). */
export default async function AccessPage(): Promise<React.JSX.Element> {
  const user = await requireUser();
  const result = await listUserAccess(user);
  if (!result.success) {
    return <StateMessage kind={result.code === "FORBIDDEN" ? "forbidden" : "error"} title="Page réservée" message={result.error} />;
  }
  return (
    <>
      <PageHeader
        title="Utilisateurs et accès"
        description="Choisissez, personne par personne et onglet par onglet, qui voit et qui modifie quoi."
        actions={<CreateUserDialog />}
      />
      <AccessMatrix users={result.data} currentUserId={user.id} />
    </>
  );
}
