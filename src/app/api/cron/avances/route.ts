import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { scheduledCaatAdvances } from "@/features/invoices/services/caat-advances";

export const dynamic = "force-dynamic";

/** GET /api/cron/avances : tâche planifiée du 1er du mois (neuf avances CAAT du mois écoulé). Protégée par CRON_SECRET. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!env.CRON_SECRET) return NextResponse.json({ error: "CRON_SECRET non configuré." }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${env.CRON_SECRET}`) return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  try {
    return NextResponse.json(await scheduledCaatAdvances());
  } catch (error) {
    console.error("[cron avances] échec :", error);
    return NextResponse.json({ error: "Création impossible." }, { status: 500 });
  }
}
