import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/utils/cn";

/** Propriétés du champ de saisie. */
export type InputProps = InputHTMLAttributes<HTMLInputElement>;

/** Champ de saisie. */
export const Input = forwardRef<HTMLInputElement, Readonly<InputProps>>(function Input({ className, type = "text", ...props }, ref) {
  return (
    <input
      ref={ref}
      type={type}
      className={cn(
        "flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-destructive",
        className,
      )}
      {...props}
    />
  );
});
