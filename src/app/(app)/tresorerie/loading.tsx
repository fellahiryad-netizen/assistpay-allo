import { Skeleton } from "@/components/ui/skeleton";

/** Chargement de la page Trésorerie. */
export default function TreasuryLoading(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-label="Chargement">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-12" />
      <Skeleton className="h-40" />
      <Skeleton className="h-72" />
    </div>
  );
}
