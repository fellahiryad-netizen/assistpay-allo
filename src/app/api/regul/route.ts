import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { exportRegul } from "@/features/regul/services/regul-service";
import { readRegulForm } from "@/features/regul/services/regul-upload";

export const dynamic = "force-dynamic";

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** POST /api/regul — classeur de régularisation CAAT 10 % + TVA calculé à partir des fichiers envoyés. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Session expirée." }, { status: 401 });
  const form = await readRegulForm(await request.formData());
  if (!form.success) return NextResponse.json({ error: form.error }, { status: 400 });
  const result = await exportRegul(user, form.data.files, form.data.options);
  if (!result.success) return NextResponse.json({ error: result.error }, { status: result.code === "FORBIDDEN" ? 403 : 500 });
  return new NextResponse(Buffer.from(result.data.bytes), {
    headers: { "Content-Type": XLSX_TYPE, "Content-Disposition": `attachment; filename="${encodeURIComponent(result.data.name)}"`, "Cache-Control": "no-store" },
  });
}
