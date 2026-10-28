import "server-only";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { SESSION_COOKIE, signSessionToken, verifySessionToken, type SessionPayload } from "@/lib/session-token";

/** Ouvre une session : signe le jeton et le dépose dans un cookie HttpOnly. */
export async function createSession(userId: string): Promise<void> {
  const token = await signSessionToken({ sub: userId }, env.SESSION_SECRET, env.SESSION_TTL_HOURS);
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: "lax",
    path: "/",
    maxAge: env.SESSION_TTL_HOURS * 3600,
  });
}

/** Lit et vérifie la session du cookie ; `null` si absente, expirée ou falsifiée. */
export async function readSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token, env.SESSION_SECRET);
}

/** Ferme la session en supprimant le cookie. */
export async function destroySession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}
