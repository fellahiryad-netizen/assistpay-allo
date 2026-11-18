import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { parsePolicesQuery } from "@/features/regul/services/regul-polices-query";
import { exportRegulPolices } from "@/features/regul/services/regul-polices-export";

export const dynamic = "force-dynamic";

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** GET /api/regul/polices?succ=&agence=&statut=&mois= — Excel des polices non retrouvées, annulées et sinistrées (CAAT Régul 10 %). */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Session expirée." }, { status: 401 });
  const query = parsePolicesQuery(Object.fromEntries(request.nextUrl.searchParams.entries()));
  const result = await exportRegulPolices(user, query);
  if (!result.success) return NextResponse.json({ error: result.error }, { status: result.code === "FORBIDDEN" ? 403 : result.code === "NOT_FOUND" ? 404 : result.code === "VALIDATION" ? 400 : 500 });
  return new NextResponse(Buffer.from(result.data.bytes), {
    headers: { "Content-Type": XLSX_TYPE, "Content-Disposition": `attachment; filename="${encodeURIComponent(result.data.name)}"`, "Cache-Control": "no-store" },
  });
}
