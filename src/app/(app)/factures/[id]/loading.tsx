import { Skeleton } from "@/components/ui/skeleton";

/** Chargement de la fiche facture. */
export default function InvoiceLoading(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-label="Chargement">
      <Skeleton className="h-8 w-72" />
      <Skeleton className="h-80" />
    </div>
  );
}
