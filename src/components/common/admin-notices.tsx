"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { dismissNoticeAction } from "@/app/actions/notice-actions";
import { Button } from "@/components/ui/button";
import type { AdminNotice } from "@/features/system/services/admin-notices";

/** Alertes aux administrateurs (par exemple une facture fournisseur corrigée après virement) ; chacune reste affichée jusqu'à ce qu'elle soit marquée comme vue. */
export function AdminNotices({ notices }: Readonly<{ notices: AdminNotice[] }>): React.JSX.Element | null {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  if (!notices.length) return null;
  return (
    <div className="mb-4 flex flex-col gap-2" role="status">
      {notices.map((notice) => (
        <div key={notice.id} className="rounded-lg border border-amber-500/60 bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-semibold">{notice.titre}</p>
              <p className="text-xs opacity-80">{new Date(notice.at).toLocaleString("fr-FR", { timeZone: "Africa/Algiers", dateStyle: "short", timeStyle: "short" })}</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {notice.lignes.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await dismissNoticeAction({ id: notice.id });
                  router.refresh();
                })
              }
            >
              Vu
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
