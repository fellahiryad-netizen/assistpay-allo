import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { readSession } from "@/lib/session";
import { loadAuthUser } from "@/features/auth/services/auth-service";
import type { AuthUser } from "@/features/access/types";

/** Utilisateur connecté pour la requête en cours (mis en cache le temps du rendu), ou `null`. */
export const getCurrentUser = cache(async (): Promise<AuthUser | null> => {
  const session = await readSession();
  if (!session) return null;
  return loadAuthUser(session.sub);
});

/** Utilisateur connecté ; redirige vers la page de connexion sinon. À utiliser dans les pages. */
export async function requireUser(): Promise<AuthUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/connexion");
  return user;
}
