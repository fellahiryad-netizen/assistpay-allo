import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { batchWorkbook } from "@/features/transfers/services/transfer-service";

export const dynamic = "force-dynamic";

/** GET /api/virements/:id/fichier — fichier Excel de l'envoi, au format de la banque. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Session expirée." }, { status: 401 });
  const { id } = await context.params;
  const parsed = z.string().min(1).max(64).safeParse(id);
  if (!parsed.success) return NextResponse.json({ error: "Identifiant invalide." }, { status: 400 });
  const result = await batchWorkbook(user, parsed.data);
  if (!result.success) return NextResponse.json({ error: result.error }, { status: result.code === "NOT_FOUND" ? 404 : result.code === "FORBIDDEN" ? 403 : 500 });
  return new NextResponse(Buffer.from(result.data.bytes), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(result.data.name)}"; filename*=UTF-8''${encodeURIComponent(result.data.name)}`,
      "Cache-Control": "no-store",
    },
  });
}
