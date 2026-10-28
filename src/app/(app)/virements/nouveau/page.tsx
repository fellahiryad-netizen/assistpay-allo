import type { Metadata } from "next";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/common/page-header";
import { StateMessage } from "@/components/common/state-message";
import { can } from "@/features/access/services/access-rules";
import { SheetBuilder } from "@/features/transfers/components/sheet-builder";
import { sheetRequests } from "@/features/transfers/services/transfer-service";

export const metadata: Metadata = { title: "État des virements" };

const idsSchema = z.string().max(20_000).transform((value) => value.split(",").map((id) => id.trim()).filter((id) => /^[A-Za-z0-9_-]{1,64}$/.test(id)).slice(0, 500));

/** État des virements à envoyer à la banque. */
export default async function TransferSheetPage({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>): Promise<React.JSX.Element> {
  const user = await requireUser();
  const raw = await searchParams;
  const ids = raw.dp ? idsSchema.parse(Array.isArray(raw.dp) ? raw.dp.join(",") : raw.dp) : null;
  const result = await sheetRequests(user, ids && ids.length ? ids : null);
  if (!result.success) return <StateMessage kind={result.code === "FORBIDDEN" ? "forbidden" : "error"} title="État des virements indisponible" message={result.error} />;
  return (
    <>
      <PageHeader title="État des virements à envoyer à la banque" description="Assistance routière et BDG séparés, un virement par prestataire, découpage au-delà de 1 000 000 DA." />
      <SheetBuilder requests={result.data.requests} others={result.data.others} scoped={Boolean(ids && ids.length)} canEdit={can(user, "VIR", "EDIT")} />
    </>
  );
}
