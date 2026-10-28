import type { HTMLAttributes } from "react";
import { cn } from "@/utils/cn";

/** Propriétés communes des blocs de carte. */
export type CardProps = HTMLAttributes<HTMLDivElement>;

/** Carte. */
export function Card({ className, ...props }: Readonly<CardProps>): React.JSX.Element {
  return <div className={cn("rounded-lg border bg-card text-card-foreground shadow-sm", className)} {...props} />;
}

/** En-tête de carte. */
export function CardHeader({ className, ...props }: Readonly<CardProps>): React.JSX.Element {
  return <div className={cn("flex flex-col gap-1 p-4 sm:p-5", className)} {...props} />;
}

/** Titre de carte. */
export function CardTitle({ className, ...props }: Readonly<HTMLAttributes<HTMLHeadingElement>>): React.JSX.Element {
  return <h2 className={cn("text-base font-semibold leading-tight", className)} {...props} />;
}

/** Description de carte. */
export function CardDescription({ className, ...props }: Readonly<HTMLAttributes<HTMLParagraphElement>>): React.JSX.Element {
  return <p className={cn("text-sm text-muted-foreground", className)} {...props} />;
}

/** Contenu de carte. */
export function CardContent({ className, ...props }: Readonly<CardProps>): React.JSX.Element {
  return <div className={cn("p-4 pt-0 sm:p-5 sm:pt-0", className)} {...props} />;
}
