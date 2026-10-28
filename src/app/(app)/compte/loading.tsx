import { Skeleton } from "@/components/ui/skeleton";

/** Chargement de la page Mon compte. */
export default function AccountLoading(): React.JSX.Element {
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2" aria-busy="true" aria-label="Chargement">
      <Skeleton className="h-80" />
      <Skeleton className="h-80" />
    </div>
  );
}
