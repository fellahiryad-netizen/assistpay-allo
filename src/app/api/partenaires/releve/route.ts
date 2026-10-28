import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { partnerQuerySchema } from "@/features/partners/schemas";
import { partnerStatement } from "@/features/partners/services/partner-service";

export const dynamic = "force-dynamic";

/** GET /api/partenaires/releve?key=…&succ=… — relevé de compte Excel d'un partenaire. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Session expirée." }, { status: 401 });
  const parsed = partnerQuerySchema.safeParse({ key: request.nextUrl.searchParams.get("key"), succ: request.nextUrl.searchParams.get("succ") ?? "" });
  if (!parsed.success) return NextResponse.json({ error: "Paramètres invalides." }, { status: 400 });
  const result = await partnerStatement(user, parsed.data);
  if (!result.success) return NextResponse.json({ error: result.error }, { status: result.code === "FORBIDDEN" ? 403 : result.code === "NOT_FOUND" ? 404 : 500 });
  return new NextResponse(Buffer.from(result.data.bytes), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(result.data.name)}"`,
      "Cache-Control": "no-store",
    },
  });
}
