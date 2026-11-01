import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { invoiceQuerySchema } from "@/features/invoices/schemas";
import { exportInvoiceList, exportSuivi } from "@/features/invoices/services/invoice-export";

export const dynamic = "force-dynamic";

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * GET /api/factures/export — Excel de la liste affichée (mêmes filtres que l'écran)
 * ou, avec `format=suivi`, du suivi complet dans les colonnes du classeur de suivi bancaire.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Session expirée." }, { status: 401 });
  const params = request.nextUrl.searchParams;
  const raw = Object.fromEntries([...params.entries()].filter(([, value]) => value !== ""));
  const query = invoiceQuerySchema.parse(raw);
  const result = params.get("format") === "suivi" ? await exportSuivi(user, query.annee) : await exportInvoiceList(user, query);
  if (!result.success) return NextResponse.json({ error: result.error }, { status: result.code === "FORBIDDEN" ? 403 : result.code === "NOT_FOUND" ? 404 : 500 });
  return new NextResponse(Buffer.from(result.data.bytes), {
    headers: { "Content-Type": XLSX_TYPE, "Content-Disposition": `attachment; filename="${encodeURIComponent(result.data.name)}"`, "Cache-Control": "no-store" },
  });
}
