import { Skeleton } from "@/components/ui/skeleton";

/** Chargement de la page. */
export default function PrintRequestsLoading(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-label="Chargement">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-10" />
      <Skeleton className="h-72" />
    </div>
  );
}
