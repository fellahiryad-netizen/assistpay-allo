import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { receivablesQuerySchema } from "@/features/receivables/schemas";
import { exportReceivableDetail } from "@/features/receivables/services/receivables-detail-export";

export const dynamic = "force-dynamic";

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** GET /api/creances/detail — Excel du détail par succursale (`detail=CAAT:BDG`, filtres année, activité et ancienneté). */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Session expirée." }, { status: 401 });
  const raw = Object.fromEntries([...request.nextUrl.searchParams.entries()].filter(([, value]) => value !== ""));
  const query = receivablesQuerySchema.parse(raw);
  const result = await exportReceivableDetail(user, query);
  if (!result.success) return NextResponse.json({ error: result.error }, { status: result.code === "FORBIDDEN" ? 403 : result.code === "VALIDATION" ? 400 : 500 });
  return new NextResponse(Buffer.from(result.data.bytes), {
    headers: { "Content-Type": XLSX_TYPE, "Content-Disposition": `attachment; filename="${encodeURIComponent(result.data.name)}"`, "Cache-Control": "no-store" },
  });
}
