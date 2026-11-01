import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { requireAccess } from "@/features/access/services/access-rules";
import { supplierTemplate } from "@/features/payment-requests/services/supplier-import";

export const dynamic = "force-dynamic";

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** GET /api/demandes/canevas — canevas Excel vierge pour l'import en masse des factures fournisseurs. */
export async function GET(): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Session expirée." }, { status: 401 });
  const allowed = requireAccess(user, "A_IMPORT", "EDIT");
  if (!allowed.success) return NextResponse.json({ error: allowed.error }, { status: 403 });
  return new NextResponse(Buffer.from(supplierTemplate()), {
    headers: { "Content-Type": XLSX_TYPE, "Content-Disposition": 'attachment; filename="Canevas_import_factures_fournisseurs.xlsx"', "Cache-Control": "no-store" },
  });
}
