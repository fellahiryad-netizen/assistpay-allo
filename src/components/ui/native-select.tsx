import { forwardRef, type SelectHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/utils/cn";

/** Propriétés de la liste déroulante native. */
export type NativeSelectProps = SelectHTMLAttributes<HTMLSelectElement>;

/** Liste déroulante native stylée (accessible au clavier et sur mobile, compatible formulaires). */
export const NativeSelect = forwardRef<HTMLSelectElement, Readonly<NativeSelectProps>>(function NativeSelect(
  { className, children, ...props },
  ref,
) {
  return (
    <div className="relative">
      <select
        ref={ref}
        className={cn(
          "flex h-10 w-full appearance-none rounded-md border border-input bg-card py-2 pl-3 pr-9 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown aria-hidden className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
});
