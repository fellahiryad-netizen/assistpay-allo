import type { HTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/utils/cn";

const badgeVariants = cva("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium", {
  variants: {
    variant: {
      default: "bg-primary/10 text-primary",
      success: "bg-success/10 text-success",
      warning: "bg-warning/10 text-warning",
      destructive: "bg-destructive/10 text-destructive",
      muted: "bg-muted text-muted-foreground",
      accent: "bg-accent/10 text-accent",
    },
  },
  defaultVariants: { variant: "default" },
});

/** Propriétés du badge. */
export interface BadgeProps extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

/** Petite pastille d'état. */
export function Badge({ className, variant, ...props }: Readonly<BadgeProps>): React.JSX.Element {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
