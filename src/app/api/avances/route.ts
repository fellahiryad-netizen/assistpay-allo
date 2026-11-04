import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { exportAdvanceTable } from "@/features/partners/services/advance-table";
import { todayIso } from "@/utils/dates";

export const dynamic = "force-dynamic";

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** GET /api/avances?client=CAAT|CAAR&annee=AAAA — Excel du tableau de paiement par succursale. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Session expirée." }, { status: 401 });
  const params = request.nextUrl.searchParams;
  const client = params.get("client") === "CAAR" ? "CAAR" : "CAAT";
  const year = Number(params.get("annee")) || Number(todayIso().slice(0, 4));
  const result = await exportAdvanceTable(user, client, year);
  if (!result.success) return NextResponse.json({ error: result.error }, { status: result.code === "FORBIDDEN" ? 403 : 500 });
  return new NextResponse(Buffer.from(result.data.bytes), {
    headers: { "Content-Type": XLSX_TYPE, "Content-Disposition": `attachment; filename="${encodeURIComponent(result.data.name)}"`, "Cache-Control": "no-store" },
  });
}
