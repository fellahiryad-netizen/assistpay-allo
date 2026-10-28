import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { hrQuerySchema } from "@/features/hr/schemas";
import { exportHr } from "@/features/hr/services/hr-service";

export const dynamic = "force-dynamic";

/** GET /api/rh/export?annee=&mois=&nature=&q= — export Excel confidentiel des saisies RH. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Session expirée." }, { status: 401 });
  const params = request.nextUrl.searchParams;
  const parsed = hrQuerySchema.safeParse({ annee: params.get("annee") ?? undefined, mois: params.get("mois") ?? undefined, nature: params.get("nature") ?? undefined, q: params.get("q") ?? undefined });
  if (!parsed.success) return NextResponse.json({ error: "Paramètres invalides." }, { status: 400 });
  const result = await exportHr(user, parsed.data);
  if (!result.success) return NextResponse.json({ error: result.error }, { status: result.code === "FORBIDDEN" ? 403 : 500 });
  return new NextResponse(Buffer.from(result.data.bytes), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(result.data.name)}"`,
      "Cache-Control": "no-store",
    },
  });
}
