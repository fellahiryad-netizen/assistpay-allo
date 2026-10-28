"use server";

import { revalidatePath } from "next/cache";
import { runAction } from "@/app/actions/action-helpers";
import { controlSettingsSchema, type ControlSettingsInput } from "@/features/settings/schemas";
import { saveControlSettings, type ControlSettings } from "@/features/settings/services/settings-service";
import type { ActionResult } from "@/types";

/** Enregistrement des paramètres de contrôle (seuil de double validation, article d'imposition). */
export async function saveControlSettingsAction(input: ControlSettingsInput): Promise<ActionResult<ControlSettings>> {
  const result = await runAction(controlSettingsSchema, input, saveControlSettings);
  if (result.success) revalidatePath("/", "layout");
  return result;
}
