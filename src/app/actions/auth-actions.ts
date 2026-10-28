"use server";

import { redirect } from "next/navigation";
import { createSession, destroySession } from "@/lib/session";
import { authenticate, changeOwnPassword } from "@/features/auth/services/auth-service";
import { changePasswordSchema, loginSchema, type ChangePasswordInput } from "@/features/auth/schemas";
import { firstIssue, runAction } from "@/app/actions/action-helpers";
import { fail, ok, type ActionResult } from "@/types";

/** Connexion : vérifie les identifiants, ouvre la session puis redirige vers l'accueil. */
export async function loginAction(_previous: ActionResult<null> | null, formData: FormData): Promise<ActionResult<null>> {
  const parsed = loginSchema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return fail(firstIssue(parsed.error), "VALIDATION");
  let result: ActionResult<{ userId: string }>;
  try {
    result = await authenticate(parsed.data);
    if (result.success) await createSession(result.data.userId);
  } catch (error) {
    console.error("[auth] connexion :", error);
    return fail("Connexion impossible pour le moment.");
  }
  if (!result.success) return fail(result.error, result.code);
  redirect("/");
}

/** Déconnexion. */
export async function logoutAction(): Promise<void> {
  await destroySession();
  redirect("/connexion");
}

/** Changement de son propre mot de passe. */
export async function changePasswordAction(input: ChangePasswordInput): Promise<ActionResult<null>> {
  const result = await runAction(changePasswordSchema, input, changeOwnPassword);
  return result.success ? ok(null) : result;
}
