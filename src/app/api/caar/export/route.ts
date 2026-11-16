import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { exportProduction } from "@/features/caar/services/caar-export";

export const dynamic = "force-dynamic";

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** GET /api/caar/export?id=… — Excel du contrôle d'une production CAAR (avant établissement de la facture). */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Session expirée." }, { status: 401 });
  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Production non précisée." }, { status: 400 });
  const result = await exportProduction(user, id);
  if (!result.success) return NextResponse.json({ error: result.error }, { status: result.code === "FORBIDDEN" ? 403 : result.code === "NOT_FOUND" ? 404 : 500 });
  return new NextResponse(Buffer.from(result.data.bytes), {
    headers: { "Content-Type": XLSX_TYPE, "Content-Disposition": `attachment; filename="${encodeURIComponent(result.data.name)}"`, "Cache-Control": "no-store" },
  });
}
