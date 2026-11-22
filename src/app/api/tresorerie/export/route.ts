import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { exportTreasury } from "@/features/treasury/services/treasury-export";
import { exportTreasuryPdf } from "@/features/treasury/services/treasury-pdf";

export const dynamic = "force-dynamic";

/** GET /api/tresorerie/export?format=xlsx|pdf&demandes=1 — export confidentiel de la trésorerie : Excel ou PDF de présentation (Administrateur, Direction, Comptable). */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Session expirée." }, { status: 401 });
  const format = request.nextUrl.searchParams.get("format") ?? "xlsx";
  if (format !== "xlsx" && format !== "pdf") return NextResponse.json({ error: "Format inconnu : xlsx ou pdf." }, { status: 400 });
  const query = { demandes: request.nextUrl.searchParams.get("demandes") === "1" };
  const result = format === "pdf" ? await exportTreasuryPdf(user, query) : await exportTreasury(user, query);
  if (!result.success) return NextResponse.json({ error: result.error }, { status: result.code === "FORBIDDEN" ? 403 : result.code === "NOT_FOUND" ? 404 : 500 });
  return new NextResponse(Buffer.from(result.data.bytes), {
    headers: {
      "Content-Type": format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(result.data.name)}"`,
      "Cache-Control": "no-store",
    },
  });
}
