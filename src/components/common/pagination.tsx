import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/utils/cn";

/** Propriétés de la pagination. */
export interface PaginationProps {
  page: number;
  pageCount: number;
  /** Construit l'URL d'une page donnée. */
  hrefFor: (page: number) => string;
}

/** Pagination par liens (fonctionne sans JavaScript). */
export function Pagination({ page, pageCount, hrefFor }: Readonly<PaginationProps>): React.JSX.Element | null {
  if (pageCount <= 1) return null;
  const prev = page > 1 ? hrefFor(page - 1) : null;
  const next = page < pageCount ? hrefFor(page + 1) : null;
  const linkClass = buttonVariants({ variant: "outline", size: "sm" });
  return (
    <nav className="flex items-center justify-between gap-2 pt-4" aria-label="Pagination">
      {prev ? (
        <Link href={prev} className={linkClass}>
          <ChevronLeft /> Précédent
        </Link>
      ) : (
        <span className={cn(linkClass, "pointer-events-none opacity-40")}>
          <ChevronLeft /> Précédent
        </span>
      )}
      <span className="text-sm text-muted-foreground">
        Page {page} / {pageCount}
      </span>
      {next ? (
        <Link href={next} className={linkClass}>
          Suivant <ChevronRight />
        </Link>
      ) : (
        <span className={cn(linkClass, "pointer-events-none opacity-40")}>
          Suivant <ChevronRight />
        </span>
      )}
    </nav>
  );
}
