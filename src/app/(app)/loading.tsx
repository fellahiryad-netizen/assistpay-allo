import { Skeleton } from "@/components/ui/skeleton";

/** Chargement du tableau de bord. */
export default function DashboardLoading(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-5" aria-busy="true" aria-label="Chargement">
      <Skeleton className="h-8 w-56" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-28" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Skeleton className="h-72" />
        <Skeleton className="h-72" />
      </div>
    </div>
  );
}
