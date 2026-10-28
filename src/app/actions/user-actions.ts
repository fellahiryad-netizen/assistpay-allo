"use server";

import { revalidatePath } from "next/cache";
import { runAction } from "@/app/actions/action-helpers";
import {
  createUserSchema,
  resetPasswordSchema,
  setActiveSchema,
  setModuleAccessSchema,
  setProfileSchema,
  type CreateUserInput,
  type ResetPasswordInput,
  type SetActiveInput,
  type SetModuleAccessInput,
  type SetProfileInput,
} from "@/features/users/schemas";
import {
  createUser,
  resetUserPassword,
  setModuleAccess,
  setUserActive,
  setUserProfile,
} from "@/features/users/services/users-service";
import type { ActionResult } from "@/types";

function refresh(): void {
  revalidatePath("/acces");
}

/** Niveau d'accès d'un utilisateur sur un onglet. */
export async function setModuleAccessAction(input: SetModuleAccessInput): Promise<ActionResult<true>> {
  const result = await runAction(setModuleAccessSchema, input, setModuleAccess);
  if (result.success) refresh();
  return result;
}

/** Profil d'un utilisateur. */
export async function setUserProfileAction(input: SetProfileInput): Promise<ActionResult<true>> {
  const result = await runAction(setProfileSchema, input, setUserProfile);
  if (result.success) refresh();
  return result;
}

/** Activation d'un compte. */
export async function setUserActiveAction(input: SetActiveInput): Promise<ActionResult<true>> {
  const result = await runAction(setActiveSchema, input, setUserActive);
  if (result.success) refresh();
  return result;
}

/** Création d'un compte. */
export async function createUserAction(input: CreateUserInput): Promise<ActionResult<{ id: string }>> {
  const result = await runAction(createUserSchema, input, createUser);
  if (result.success) refresh();
  return result;
}

/** Nouveau mot de passe pour un compte. */
export async function resetUserPasswordAction(input: ResetPasswordInput): Promise<ActionResult<true>> {
  const result = await runAction(resetPasswordSchema, input, resetUserPassword);
  if (result.success) refresh();
  return result;
}
