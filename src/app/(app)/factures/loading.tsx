import { Skeleton } from "@/components/ui/skeleton";

/** Chargement de la liste des factures. */
export default function InvoicesLoading(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-label="Chargement">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-24" />
      {Array.from({ length: 8 }, (_, index) => (
        <Skeleton key={index} className="h-12" />
      ))}
    </div>
  );
}
