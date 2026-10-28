import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { buildBackup } from "@/features/pilot/services/backup-service";

export const dynamic = "force-dynamic";

/** GET /api/sauvegarde?format=xlsx|json — sauvegarde complète des données. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Session expirée." }, { status: 401 });
  const format = request.nextUrl.searchParams.get("format") === "json" ? "json" : "xlsx";
  const result = await buildBackup(user, format);
  if (!result.success) return NextResponse.json({ error: result.error }, { status: result.code === "FORBIDDEN" ? 403 : 500 });
  return new NextResponse(Buffer.from(result.data.bytes), {
    headers: { "Content-Type": result.data.type, "Content-Disposition": `attachment; filename="${encodeURIComponent(result.data.name)}"`, "Cache-Control": "no-store" },
  });
}
