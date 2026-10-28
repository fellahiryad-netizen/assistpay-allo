import { jwtVerify, SignJWT } from "jose";

/** Nom du cookie de session. */
export const SESSION_COOKIE = "ap_session";

/** Contenu signé de la session. */
export interface SessionPayload {
  sub: string;
}

const encoder = new TextEncoder();

/** Signe un jeton de session HS256 valable `ttlHours` heures. */
export async function signSessionToken(payload: SessionPayload, secret: string, ttlHours: number): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setIssuer("assistpay")
    .setExpirationTime(`${ttlHours}h`)
    .sign(encoder.encode(secret));
}

/** Vérifie la signature et l'expiration d'un jeton ; renvoie `null` s'il est invalide. */
export async function verifySessionToken(token: string, secret: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, encoder.encode(secret), { issuer: "assistpay", algorithms: ["HS256"] });
    return typeof payload.sub === "string" && payload.sub.length > 0 ? { sub: payload.sub } : null;
  } catch {
    return null;
  }
}
