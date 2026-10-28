import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/common/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LEVEL_LABELS, MODULES, PROFILE_LABELS } from "@/features/access/services/access-rules";
import { ChangePasswordForm } from "@/features/auth/components/change-password-form";

export const metadata: Metadata = { title: "Mon compte" };

/** Mon compte : identité, accès effectifs et changement de mot de passe. */
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
        <Card>
          <CardHeader>
            <CardTitle>Mes accès</CardTitle>
            <CardDescription>Profil : {PROFILE_LABELS[user.profile]}</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {MODULES.map((module) => (
                <li key={module.key} className="flex justify-between gap-3 py-2">
                  <span>{module.label}</span>
                  <span className="text-muted-foreground">{LEVEL_LABELS[user.access[module.key]]}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
