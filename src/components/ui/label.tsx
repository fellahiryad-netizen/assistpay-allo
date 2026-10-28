"use client";

import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from "react";
import * as LabelPrimitive from "@radix-ui/react-label";
import { cn } from "@/utils/cn";

/** Propriétés de l'étiquette. */
export type LabelProps = ComponentPropsWithoutRef<typeof LabelPrimitive.Root>;

/** Étiquette de champ (Radix Label). */
export const Label = forwardRef<ElementRef<typeof LabelPrimitive.Root>, Readonly<LabelProps>>(function Label({ className, ...props }, ref) {
  return <LabelPrimitive.Root ref={ref} className={cn("text-sm font-medium leading-none text-foreground", className)} {...props} />;
});
