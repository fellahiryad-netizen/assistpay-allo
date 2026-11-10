"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { runAction } from "@/app/actions/action-helpers";
import { dismissAdminNotice } from "@/features/system/services/admin-notices";
import type { ActionResult } from "@/types";

const schema = z.object({ id: z.string().min(1).max(120) });

/** Marque une alerte administrateur comme vue. */
export async function dismissNoticeAction(input: z.input<typeof schema>): Promise<ActionResult<true>> {
  const result = await runAction(schema, input, (actor, value) => dismissAdminNotice(actor, value.id));
  if (result.success) revalidatePath("/", "layout");
  return result;
}
