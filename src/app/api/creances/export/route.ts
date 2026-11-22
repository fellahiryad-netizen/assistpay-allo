import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { receivablesQuerySchema } from "@/features/receivables/schemas";
import { exportReceivables } from "@/features/receivables/services/receivables-export";

export const dynamic = "force-dynamic";

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** GET /api/creances/export — Excel des créances par compagnie (mêmes filtres année et activité que la page). */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Session expirée." }, { status: 401 });
  const raw = Object.fromEntries([...request.nextUrl.searchParams.entries()].filter(([, value]) => value !== ""));
  const query = receivablesQuerySchema.parse(raw);
  const result = await exportReceivables(user, query);
  if (!result.success) return NextResponse.json({ error: result.error }, { status: result.code === "FORBIDDEN" ? 403 : 500 });
  return new NextResponse(Buffer.from(result.data.bytes), {
    headers: { "Content-Type": XLSX_TYPE, "Content-Disposition": `attachment; filename="${encodeURIComponent(result.data.name)}"`, "Cache-Control": "no-store" },
  });
}
