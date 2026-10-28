import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LoginForm } from "@/features/auth/components/login-form";

export const metadata: Metadata = { title: "Connexion" };

/** Page de connexion. */
export default async function LoginPage(): Promise<React.JSX.Element> {
  const user = await getCurrentUser();
  if (user) redirect("/");
  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2">
          <span className="grid size-10 place-items-center rounded-lg bg-primary text-lg font-bold text-primary-foreground">A</span>
          <p className="text-2xl font-semibold">
            Assist<span className="text-primary">Pay</span>
          </p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Connexion</CardTitle>
            <CardDescription>Facturation · créances · règlements – Allo Assistance</CardDescription>
          </CardHeader>
          <CardContent>
            <LoginForm />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
