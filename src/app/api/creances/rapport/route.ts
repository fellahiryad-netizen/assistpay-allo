import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { receivablesQuerySchema } from "@/features/receivables/schemas";
import { exportImpayesReport } from "@/features/receivables/services/receivables-report";

export const dynamic = "force-dynamic";

/** GET /api/creances/rapport?detail=CAAR — rapport PDF des factures impayées d'une compagnie, à présenter à sa direction. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Session expirée." }, { status: 401 });
  const raw = Object.fromEntries([...request.nextUrl.searchParams.entries()].filter(([, value]) => value !== ""));
  const query = receivablesQuerySchema.parse(raw);
  const result = await exportImpayesReport(user, query);
  if (!result.success) return NextResponse.json({ error: result.error }, { status: result.code === "FORBIDDEN" ? 403 : result.code === "VALIDATION" ? 400 : 500 });
  return new NextResponse(Buffer.from(result.data.bytes), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${encodeURIComponent(result.data.name)}"`, "Cache-Control": "no-store" },
  });
}
