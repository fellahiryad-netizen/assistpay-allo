import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { exportGamDetail } from "@/features/billing/services/gam-detail-export";

export const dynamic = "force-dynamic";

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** GET /api/bdg/gam-detail?conv=<id>&takaful=<id> — Excel du détail des factures globales BDG GAM (feuilles CONV et TAKAFUL). */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Session expirée." }, { status: 401 });
  const params = request.nextUrl.searchParams;
  const conv = params.get("conv") || undefined;
  const takaful = params.get("takaful") || undefined;
  if (!conv && !takaful) return NextResponse.json({ error: "Facture non précisée." }, { status: 400 });
  const result = await exportGamDetail(user, { conv, takaful });
  if (!result.success) {
    const status = result.code === "FORBIDDEN" ? 403 : result.code === "NOT_FOUND" ? 404 : result.code === "VALIDATION" ? 400 : 500;
    return NextResponse.json({ error: result.error }, { status });
  }
  return new NextResponse(Buffer.from(result.data.bytes), {
    headers: { "Content-Type": XLSX_TYPE, "Content-Disposition": `attachment; filename="${encodeURIComponent(result.data.name)}"`, "Cache-Control": "no-store" },
  });
}
