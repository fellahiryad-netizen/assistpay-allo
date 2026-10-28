import { db } from "@/lib/db";

/** État de l'application pour la supervision. */
export interface HealthStatus {
  status: "ok" | "degraded";
  database: "ok" | "unreachable";
  time: string;
}

/** Vérifie que la base répond (requête minimale). */
export async function checkHealth(): Promise<HealthStatus> {
  try {
    await db.$queryRaw`SELECT 1`;
    return { status: "ok", database: "ok", time: new Date().toISOString() };
  } catch (error) {
    console.error("[health] base injoignable :", error);
    return { status: "degraded", database: "unreachable", time: new Date().toISOString() };
  }
}
