import type { HTMLAttributes } from "react";
import { cn } from "@/utils/cn";

/** Propriétés du squelette de chargement. */
export type SkeletonProps = HTMLAttributes<HTMLDivElement>;

/** Bloc animé affiché pendant le chargement. */
export function Skeleton({ className, ...props }: Readonly<SkeletonProps>): React.JSX.Element {
  return <div className={cn("animate-pulse rounded-md bg-muted", className)} {...props} />;
}
