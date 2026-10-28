import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/common/page-header";
import { Pagination } from "@/components/common/pagination";
import { StateMessage } from "@/components/common/state-message";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { JournalTable } from "@/features/journal/components/journal-table";
import { listJournal } from "@/features/journal/services/journal-service";
import type { JournalQuery } from "@/features/journal/types";
import { cn } from "@/utils/cn";

export const metadata: Metadata = { title: "Journal des actions" };

const querySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
  q: z.string().trim().max(120).catch(""),
  scope: z.enum(["general", "admin"]).catch("general"),
});

function href(query: JournalQuery, page: number): string {
  const params = new URLSearchParams();
  if (query.scope === "admin") params.set("scope", "admin");
  if (query.q) params.set("q", query.q);
  if (page > 1) params.set("page", String(page));
  const search = params.toString();
  return search ? `/journal?${search}` : "/journal";
}

/** Journal des actions (le journal d'administration est réservé aux administrateurs). */
export default async function JournalPage({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>): Promise<React.JSX.Element> {
  const user = await requireUser();
  const raw = await searchParams;
  const query = querySchema.parse({ page: raw.page ?? 1, q: raw.q ?? "", scope: raw.scope ?? "general" });
  const result = await listJournal(user, query);
  const tab = (scope: JournalQuery["scope"], label: string): React.JSX.Element => (
    <Link
      href={href({ ...query, scope, page: 1 }, 1)}
      aria-current={query.scope === scope ? "page" : undefined}
      className={cn("rounded-md px-3 py-1.5 text-sm font-medium", query.scope === scope ? "bg-primary/10 text-primary" : "hover:bg-muted")}
    >
      {label}
    </Link>
  );
  return (
    <>
      <PageHeader title="Journal des actions" description="Qui a fait quoi, et quand." />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-1">
          {tab("general", "Général")}
          {user.isAdmin ? tab("admin", "Administration (RH, accès)") : null}
        </div>
        <form method="get" className="flex gap-2" role="search">
          {query.scope === "admin" ? <input type="hidden" name="scope" value="admin" /> : null}
          <Input name="q" defaultValue={query.q} placeholder="Rechercher…" aria-label="Rechercher dans le journal" className="sm:w-64" />
          <Button type="submit" variant="outline">
            Rechercher
          </Button>
        </form>
      </div>
      {!result.success ? (
        <StateMessage kind={result.code === "FORBIDDEN" ? "forbidden" : "error"} title="Journal indisponible" message={result.error} />
      ) : result.data.items.length === 0 ? (
        <StateMessage kind="empty" title="Aucune action trouvée" />
      ) : (
        <>
          <JournalTable items={result.data.items} />
          <Pagination page={result.data.page} pageCount={result.data.pageCount} hrefFor={(page) => href(query, page)} />
        </>
      )}
    </>
  );
}
