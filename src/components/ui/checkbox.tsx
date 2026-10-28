import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/utils/cn";

/** Propriétés de la case à cocher. */
export type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type">;

/** Case à cocher native, bien visible. */
export const Checkbox = forwardRef<HTMLInputElement, Readonly<CheckboxProps>>(function Checkbox({ className, ...props }, ref) {
  return <input ref={ref} type="checkbox" className={cn("size-4 shrink-0 cursor-pointer rounded border-input accent-primary disabled:cursor-not-allowed", className)} {...props} />;
});
