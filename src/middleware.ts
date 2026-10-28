import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session-token";

/**
 * Première barrière : toute page hors connexion exige un jeton de session valide.
 * Les droits fins (onglets, niveaux) sont contrôlés dans les services, à chaque requête.
 */
export async function middleware(request: NextRequest): Promise<NextResponse> {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySessionToken(token, env.SESSION_SECRET) : null;
  const isLogin = request.nextUrl.pathname === "/connexion";
  if (!session && !isLogin) {
    const url = request.nextUrl.clone();
    url.pathname = "/connexion";
    url.search = "";
    const response = NextResponse.redirect(url);
    if (token) response.cookies.delete(SESSION_COOKIE);
    return response;
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api/health|_next/static|_next/image|favicon.ico|icon.png|logo-allo.png).*)"],
};
