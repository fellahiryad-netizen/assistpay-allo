import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { envoiFiltersSchema } from "@/features/courrier/schemas";
import { exportEnvois } from "@/features/courrier/services/envoi-service";

export const dynamic = "force-dynamic";

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** GET /api/courrier/envois — Excel de l'historique des bordereaux, avec les mêmes filtres que l'écran (q, du, au, ramasse, statut, compagnie). */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Session expirée." }, { status: 401 });
  const params = request.nextUrl.searchParams;
  const filters = envoiFiltersSchema.parse({ q: params.get("q") ?? "", du: params.get("du") ?? "", au: params.get("au") ?? "", ramasse: params.get("ramasse") ?? "", statut: params.get("statut") ?? "", compagnie: params.get("compagnie") ?? "" });
  const result = await exportEnvois(user, filters);
  if (!result.success) return NextResponse.json({ error: result.error }, { status: result.code === "FORBIDDEN" ? 403 : 500 });
  return new NextResponse(Buffer.from(result.data.bytes), {
    headers: { "Content-Type": XLSX_TYPE, "Content-Disposition": `attachment; filename="${encodeURIComponent(result.data.name)}"`, "Cache-Control": "no-store" },
  });
}
