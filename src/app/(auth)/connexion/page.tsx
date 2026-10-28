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
    <main className="login-brand grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3">
          <img src="/logo-allo.png" alt="Allo Assistance" width={150} height={83} className="h-auto w-[150px]" />
          <p className="text-2xl font-semibold text-white">
            Assist<span className="text-[hsl(36_100%_55%)]">Pay</span>
          </p>
        </div>
        <Card className="border-white/10 shadow-2xl">
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
