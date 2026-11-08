import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { readMlaFile } from "@/features/mla/services/mla-store";

export const dynamic = "force-dynamic";

/** GET /api/mla/fichiers/<id> — télécharge un fichier de production MLA conservé dans la fiche. */
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Session expirée." }, { status: 401 });
  const { id } = await context.params;
  const result = await readMlaFile(user, id);
  if (!result.success) return NextResponse.json({ error: result.error }, { status: result.code === "FORBIDDEN" ? 403 : result.code === "NOT_FOUND" ? 404 : 500 });
  return new NextResponse(Buffer.from(result.data.data), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(result.data.name)}`,
      "Cache-Control": "no-store",
    },
  });
}
