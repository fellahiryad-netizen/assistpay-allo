import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/common/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChangePasswordForm } from "@/features/auth/components/change-password-form";

export const metadata: Metadata = { title: "Mon compte" };

/** Mon compte : identité et changement de mot de passe. */
export default async function AccountPage(): Promise<React.JSX.Element> {
  const user = await requireUser();
  return (
    <>
      <PageHeader title="Mon compte" description={`${user.name} · ${user.email}`} />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Mot de passe</CardTitle>
            <CardDescription>Choisissez un mot de passe d&apos;au moins 10 caractères.</CardDescription>
          </CardHeader>
          <CardContent>
            <ChangePasswordForm />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
