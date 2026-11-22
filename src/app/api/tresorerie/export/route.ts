import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { exportTreasury } from "@/features/treasury/services/treasury-export";

export const dynamic = "force-dynamic";

/** GET /api/tresorerie/export?demandes=1 — export Excel confidentiel de la trésorerie (Administrateur, Direction, Comptable). */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Session expirée." }, { status: 401 });
  const result = await exportTreasury(user, { demandes: request.nextUrl.searchParams.get("demandes") === "1" });
  if (!result.success) return NextResponse.json({ error: result.error }, { status: result.code === "FORBIDDEN" ? 403 : result.code === "NOT_FOUND" ? 404 : 500 });
  return new NextResponse(Buffer.from(result.data.bytes), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(result.data.name)}"`,
      "Cache-Control": "no-store",
    },
  });
}
