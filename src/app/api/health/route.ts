import { NextResponse } from "next/server";
import { checkHealth, type HealthStatus } from "@/features/system/services/health-service";

export const dynamic = "force-dynamic";

/** GET /api/health : supervision (200 si la base répond, 503 sinon). */
export async function GET(): Promise<NextResponse<HealthStatus>> {
  const health = await checkHealth();
  return NextResponse.json(health, { status: health.status === "ok" ? 200 : 503 });
}
